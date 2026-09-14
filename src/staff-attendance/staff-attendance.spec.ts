import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import * as request from 'supertest';
import { Admin } from '../admin/schemas/admin.schema';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { GlobalExceptionFilter } from '../filters/http-exception.filter';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { School, WEEKDAYS } from '../platform/schools/schemas/school.schema';
import { SchoolsController } from '../platform/schools/schools.controller';
import { SchoolsService } from '../platform/schools/schools.service';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import { TenantContextInterceptor } from '../tenancy/tenant-context.interceptor';
import { StaffAttendance } from './schemas/staff-attendance.schema';
import { StaffAttendanceModule } from './staff-attendance.module';
import { staffCalendarDate } from './staff-attendance.service';

// Always a new, isolated local database. Never use the application's MONGODB_URI.
const dbName = `nasaq_staff_attendance_test_${new Types.ObjectId()}`;
const secret = 'staff-attendance-integration-test-secret';
const location = { lat: 24.7136, lng: 46.6753 };
const schoolId = new Types.ObjectId();
const otherSchoolId = new Types.ObjectId();
const managerId = new Types.ObjectId();
const supervisorId = new Types.ObjectId();
const ownerId = new Types.ObjectId();
const otherManagerId = new Types.ObjectId();
const manual = {
  staffId: String(managerId),
  date: '2025-01-06',
  checkInAt: '2025-01-06T07:45:00+03:00',
  checkOutAt: '2025-01-06T13:30:00+03:00',
  notes: 'اختبار تسجيل يدوي',
};

describe('Staff attendance HTTP integration (isolated local MongoDB)', () => {
  let app: INestApplication;
  let connection: Connection;
  let jwt: JwtService;
  let schools: Model<School>;
  let admins: Model<Admin>;
  let records: Model<StaffAttendance>;

  const token = (
    role = 'MANAGER',
    sub = managerId,
    tenant: Types.ObjectId | null = schoolId,
  ) =>
    jwt.sign({
      sub: String(sub),
      role,
      schoolId: tenant ? String(tenant) : null,
      email: 'test@example.invalid',
    });
  const api = (role = 'MANAGER', sub = managerId, tenant = schoolId) => {
    const bearer = `Bearer ${token(role, sub, tenant)}`;
    return {
      get: (path: string) =>
        request(app.getHttpServer()).get(path).set('Authorization', bearer),
      post: (path: string) =>
        request(app.getHttpServer()).post(path).set('Authorization', bearer),
      patch: (path: string) =>
        request(app.getHttpServer()).patch(path).set('Authorization', bearer),
      delete: (path: string) =>
        request(app.getHttpServer()).delete(path).set('Authorization', bearer),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        StaffAttendanceModule,
        PassportModule,
        JwtModule.register({ secret }),
      ],
      controllers: [SchoolsController],
      providers: [
        { provide: ConfigService, useValue: { get: () => secret } },
        JwtStrategy,
        CaslAbilityFactory,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: AbilitiesGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        {
          provide: SchoolsService,
          inject: [getConnectionToken()],
          useFactory: (conn: Connection) =>
            new SchoolsService(
              conn.model(School.name),
              conn.model(Admin.name),
              null,
              conn,
              null,
              null,
            ),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(
      new TenantContextInterceptor(),
      new ResponseInterceptor(),
    );
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    jwt = moduleRef.get(JwtService);
    schools = connection.model(School.name);
    admins = connection.model(Admin.name);
    records = connection.model(StaffAttendance.name);
    await records.init();
  }, 20000);

  afterAll(async () => {
    if (
      connection?.name === dbName &&
      /^nasaq_staff_attendance_test_[a-f\d]{24}$/.test(connection.name)
    ) {
      await connection.dropDatabase();
    }
    await app?.close();
  });

  beforeEach(async () => {
    await Promise.all([
      records.collection.deleteMany({}),
      admins.collection.deleteMany({}),
      schools.collection.deleteMany({}),
    ]);
    const settings = {
      timezone: 'Asia/Riyadh',
      location,
      staffCheckInEnabled: true,
      teacherCheckInEnabled: false,
      checkInRadiusMeters: 150,
      schoolNetworkIps: [],
      workSchedule: WEEKDAYS.map((day) => ({
        day,
        isWorkingDay: day !== 'friday',
        startTime: '07:30',
        endTime: '14:00',
      })),
    };
    await schools.create([
      {
        _id: schoolId,
        name: 'Test school',
        slug: 'staff-test',
        email: 'school@example.invalid',
        settings,
      },
      {
        _id: otherSchoolId,
        name: 'Other school',
        slug: 'staff-test-other',
        email: 'other@example.invalid',
        settings,
      },
    ]);
    await admins.collection.insertMany([
      {
        _id: managerId,
        schoolId,
        username: 'المدير',
        email: 'manager@example.invalid',
        role: 'MANAGER',
        password: 'unused',
      },
      {
        _id: supervisorId,
        schoolId,
        username: 'المشرف',
        email: 'supervisor@example.invalid',
        role: 'SUPERVISOR',
        password: 'unused',
      },
      {
        _id: ownerId,
        schoolId,
        username: 'المالك',
        email: 'owner@example.invalid',
        role: 'OWNER',
        password: 'unused',
      },
      {
        _id: otherManagerId,
        schoolId: otherSchoolId,
        username: 'مدير مدرسة أخرى',
        email: 'other-manager@example.invalid',
        role: 'MANAGER',
        password: 'unused',
      },
    ]);
  });

  it.each([
    ['MANAGER', managerId],
    ['SUPERVISOR', supervisorId],
  ])(
    '%s can check in, read own history and check out',
    async (role: string, id: Types.ObjectId) => {
      const client = api(role, id);
      const start = await client
        .post('/staff-attendance/check-in')
        .send(location)
        .expect(200);
      expect(start.body).toMatchObject({
        status: true,
        data: {
          staffId: String(id),
          role,
          method: 'location',
          verification: { gps: true, network: false },
        },
      });
      expect(start.body.data.recordedBy).toBeNull();
      const history = await client
        .get('/staff-attendance/me?limit=1')
        .expect(200);
      expect(history.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 1,
        totalPages: 1,
      });
      const end = await client
        .post('/staff-attendance/check-out')
        .send(location)
        .expect(200);
      expect(end.body.data.checkOutAt).toBeTruthy();
      expect(end.body.data.workMinutes).toBeGreaterThanOrEqual(0);
      expect(end.body.data.checkOutMethod).toBe('location');
    },
  );

  it.each(['OWNER', 'TEACHER', 'STUDENT', 'SUPER_ADMIN'])(
    'refuses %s self attendance',
    async (role) => {
      for (const path of ['check-in', 'check-out']) {
        await api(role)
          .post(`/staff-attendance/${path}`)
          .send(location)
          .expect(403);
      }
      await api(role).get('/staff-attendance/me').expect(403);
    },
  );

  it.each(['TEACHER', 'STUDENT', 'SUPER_ADMIN'])(
    'refuses %s access to staff management',
    async (role) => {
      const client = api(role);
      for (const path of [
        '',
        '/staff',
        '/absent',
        '/summary?dateFrom=2025-01-01&dateTo=2025-01-31',
        '/detect-ip',
      ]) {
        await client.get(`/staff-attendance${path}`).expect(403);
      }
      await client.post('/staff-attendance').send(manual).expect(403);
      await client
        .patch(`/staff-attendance/${new Types.ObjectId()}`)
        .send({ notes: 'x' })
        .expect(403);
      await client
        .delete(`/staff-attendance/${new Types.ObjectId()}`)
        .expect(403);
    },
  );

  it('requires a verified JWT', async () => {
    await request(app.getHttpServer()).get('/staff-attendance').expect(401);
    await request(app.getHttpServer())
      .post('/staff-attendance/check-in')
      .set('Authorization', 'Bearer forged')
      .send(location)
      .expect(401);
  });

  it('rejects a stale role and suspended school', async () => {
    await api('MANAGER', ownerId)
      .post('/staff-attendance/check-in')
      .send(location)
      .expect(404);
    await schools.collection.updateOne(
      { _id: schoolId },
      { $set: { isActive: false } },
    );
    await api().post('/staff-attendance/check-in').send(location).expect(403);
  });

  it('directory includes only this school managers/supervisors and only public fields', async () => {
    const result = await api('OWNER', ownerId)
      .get('/staff-attendance/staff')
      .expect(200);
    expect(result.body.data.map((s: any) => s.staffId).sort()).toEqual(
      [String(managerId), String(supervisorId)].sort(),
    );
    for (const staff of result.body.data)
      expect(Object.keys(staff).sort()).toEqual([
        'email',
        'name',
        'role',
        'staffId',
      ]);
    const filtered = await api()
      .get('/staff-attendance/staff?role=SUPERVISOR')
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
  });

  it.each([
    ['OWNER', ownerId],
    ['MANAGER', managerId],
    ['SUPERVISOR', supervisorId],
  ])(
    '%s can create, correct and delete staff attendance',
    async (role: string, id: Types.ObjectId) => {
      const client = api(role, id);
      const created = await client
        .post('/staff-attendance')
        .send(manual)
        .expect(201);
      expect(created.body.data).toMatchObject({
        lateMinutes: 15,
        earlyLeaveMinutes: 30,
        workMinutes: 345,
        expectedWorkMinutes: 390,
        recordedBy: String(id),
      });
      const recordId = created.body.data._id;
      const updated = await client
        .patch(`/staff-attendance/${recordId}`)
        .send({ checkInAt: '2025-01-06T07:30:00+03:00' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        lateMinutes: 0,
        workMinutes: 360,
        method: 'manual',
      });
      await client.delete(`/staff-attendance/${recordId}`).expect(200);
      await client.delete(`/staff-attendance/${recordId}`).expect(404);
    },
  );

  it('manual entry also supports supervisors and stays available when self check-in is disabled', async () => {
    await api()
      .patch('/schools/me/settings')
      .send({ staffCheckInEnabled: false })
      .expect(200);
    const created = await api()
      .post('/staff-attendance')
      .send({ ...manual, staffId: String(supervisorId) })
      .expect(201);
    expect(created.body.data).toMatchObject({
      role: 'SUPERVISOR',
      staffId: String(supervisorId),
    });
    await api().post('/staff-attendance/check-in').send(location).expect(400);
  });

  it('validates enabling the independent setting and reads it back', async () => {
    await schools.collection.updateOne(
      { _id: schoolId },
      {
        $set: {
          'settings.location': null,
          'settings.staffCheckInEnabled': false,
        },
      },
    );
    await api()
      .patch('/schools/me/settings')
      .send({ staffCheckInEnabled: true })
      .expect(400);
    await api()
      .patch('/schools/me/settings')
      .send({ staffCheckInEnabled: true, location })
      .expect(200);
    const settings = await api().get('/schools/me/settings').expect(200);
    expect(settings.body.data.staffCheckInEnabled).toBe(true);
    expect(settings.body.data.teacherCheckInEnabled).toBe(false);
    await api('TEACHER')
      .patch('/schools/me/settings')
      .send({ staffCheckInEnabled: false })
      .expect(403);
  });

  it('accepts network-only verification and rejects a spoofed forwarding header', async () => {
    await api()
      .patch('/schools/me/settings')
      .send({ schoolNetworkIps: ['127.0.0.1'] })
      .expect(200);
    const passed = await api()
      .post('/staff-attendance/check-in')
      .send({ lat: 0, lng: 0 })
      .expect(200);
    expect(passed.body.data.verification).toEqual({
      gps: false,
      network: true,
    });
    await api()
      .patch('/schools/me/settings')
      .send({ schoolNetworkIps: ['203.0.113.10'] })
      .expect(200);
    await api('SUPERVISOR', supervisorId)
      .post('/staff-attendance/check-in')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ lat: 0, lng: 0 })
      .expect(403);
  });

  it('enforces check-out prerequisites and location verification', async () => {
    await api().post('/staff-attendance/check-out').send(location).expect(400);
    await api().post('/staff-attendance/check-in').send(location).expect(200);
    await api()
      .post('/staff-attendance/check-out')
      .send({ lat: 0, lng: 0 })
      .expect(403);
  });

  it('returns one successful concurrent check-in/check-out and a recoverable duplicate', async () => {
    const starts = await Promise.all(
      [1, 2].map(() => api().post('/staff-attendance/check-in').send(location)),
    );
    expect(starts.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(starts.find((r) => r.status === 409)?.body.data).toMatchObject({
      alreadyCheckedIn: true,
      record: { staffId: String(managerId) },
    });
    const ends = await Promise.all(
      [1, 2].map(() =>
        api().post('/staff-attendance/check-out').send(location),
      ),
    );
    expect(ends.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      ends.find((r) => r.status === 409)?.body.data.alreadyCheckedOut,
    ).toBe(true);
    expect(await records.collection.countDocuments()).toBe(1);
  });

  it('preserves duplicate semantics for manual records', async () => {
    await api().post('/staff-attendance').send(manual).expect(201);
    const duplicate = await api()
      .post('/staff-attendance')
      .send(manual)
      .expect(409);
    expect(duplicate.body.data.alreadyCheckedIn).toBe(true);
  });

  it('locks personal history to the caller while preserving pagination and exact date filters', async () => {
    await api().post('/staff-attendance').send(manual).expect(201);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, staffId: String(supervisorId) })
      .expect(201);
    const mine = await api()
      .get(
        `/staff-attendance/me?staffId=${supervisorId}&role=SUPERVISOR&date=2025-01-06`,
      )
      .expect(200);
    expect(mine.body.meta.total).toBe(1);
    expect(mine.body.data[0].staffId).toBe(String(managerId));
    const empty = await api()
      .get('/staff-attendance/me?date=2025-01-07')
      .expect(200);
    expect(empty.body.meta.total).toBe(0);
    const list = await api()
      .get('/staff-attendance?limit=1&page=2&method=manual')
      .expect(200);
    expect(list.body.meta).toEqual({
      total: 2,
      page: 2,
      limit: 1,
      totalPages: 2,
    });
    const role = await api()
      .get('/staff-attendance?role=SUPERVISOR')
      .expect(200);
    expect(role.body.data[0].role).toBe('SUPERVISOR');
  });

  it('isolates manual targets, reads, aggregates, corrections and deletion between schools', async () => {
    const foreign = api('MANAGER', otherManagerId, otherSchoolId);
    const record = await foreign
      .post('/staff-attendance')
      .send({ ...manual, staffId: String(otherManagerId) })
      .expect(201);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, staffId: String(otherManagerId) })
      .expect(404);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, staffId: String(ownerId) })
      .expect(404);
    const list = await api()
      .get('/staff-attendance')
      .set('X-School-Id', String(otherSchoolId))
      .expect(200);
    expect(list.body.data).toEqual([]);
    const summary = await api()
      .get('/staff-attendance/summary?dateFrom=2025-01-01&dateTo=2025-01-31')
      .expect(200);
    expect(summary.body.totalStaff).toBe(0);
    await api()
      .patch(`/staff-attendance/${record.body.data._id}`)
      .send({ notes: 'blocked' })
      .expect(404);
    await api().delete(`/staff-attendance/${record.body.data._id}`).expect(404);
    expect(await records.collection.countDocuments()).toBe(1);
  });

  it('computes absences on working days and returns nobody on days off', async () => {
    await api().post('/staff-attendance').send(manual).expect(201);
    const absent = await api()
      .get('/staff-attendance/absent?date=2025-01-06')
      .expect(200);
    expect(absent.body).toMatchObject({
      totalAbsent: 1,
      absentStaff: [{ staffId: String(supervisorId) }],
    });
    const off = await api()
      .get('/staff-attendance/absent?date=2025-01-10')
      .expect(200);
    expect(off.body).toMatchObject({
      isWorkingDay: false,
      totalAbsent: 0,
      absentStaff: [],
    });
    const filtered = await api()
      .get('/staff-attendance/absent?date=2025-01-06&role=MANAGER')
      .expect(200);
    expect(filtered.body.totalAbsent).toBe(0);
    await api().get('/staff-attendance/absent?date=2099-01-01').expect(400);
  });

  it('summarizes measured time and missing check-outs, retaining deleted staff history', async () => {
    await api().post('/staff-attendance').send(manual).expect(201);
    const open = { ...manual, checkOutAt: undefined };
    await api()
      .post('/staff-attendance')
      .send({
        ...open,
        date: '2025-01-07',
        checkInAt: '2025-01-07T07:30:00+03:00',
      })
      .expect(201);
    await admins.collection.deleteOne({ _id: managerId });
    const report = await api('OWNER', ownerId)
      .get('/staff-attendance/summary?dateFrom=2025-01-01&dateTo=2025-01-31')
      .expect(200);
    expect(report.body).toMatchObject({
      totalStaff: 1,
      data: [
        {
          staffId: String(managerId),
          name: 'المدير',
          daysPresent: 2,
          daysLate: 1,
          totalLateMinutes: 15,
          daysLeftEarly: 1,
          totalEarlyLeaveMinutes: 30,
          totalWorkMinutes: 345,
          totalExpectedWorkMinutes: 780,
          daysMissingCheckOut: 1,
        },
      ],
    });
  });

  it('marks manual correction of a location record accurately and rejects reversed times without saving', async () => {
    const result = await api()
      .post('/staff-attendance/check-in')
      .send(location)
      .expect(200);
    const corrected = await api()
      .patch(`/staff-attendance/${result.body.data._id}`)
      .send({ checkInAt: result.body.data.checkInAt })
      .expect(200);
    expect(corrected.body.data).toMatchObject({
      method: 'manual',
      coordinates: null,
      distanceMeters: null,
      verification: { gps: false, network: false },
      recordedBy: String(managerId),
    });
    const old = await api().post('/staff-attendance').send(manual).expect(201);
    await api()
      .patch(`/staff-attendance/${old.body.data._id}`)
      .send({ checkInAt: '2025-01-06T14:00:00+03:00' })
      .expect(400);
    const saved = await records.collection.findOne({
      _id: new Types.ObjectId(old.body.data._id),
    });
    expect(saved.checkInAt.toISOString()).toBe('2025-01-06T04:45:00.000Z');
  });

  it('rejects invalid IDs, dates, coordinates, time ranges and client-owned identity fields', async () => {
    for (const extra of [
      { schoolId: String(otherSchoolId) },
      { staffId: String(supervisorId) },
      { role: 'SUPERVISOR' },
      { checkInAt: manual.checkInAt },
    ]) {
      await api()
        .post('/staff-attendance/check-in')
        .send({ ...location, ...extra })
        .expect(400);
    }
    await api()
      .post('/staff-attendance/check-in')
      .send({ lat: 91, lng: 0 })
      .expect(400);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, date: '2025-02-30' })
      .expect(400);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, checkInAt: '07:45' })
      .expect(400);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, checkInAt: '2025-01-07T07:45:00+03:00' })
      .expect(400);
    await api()
      .post('/staff-attendance')
      .send({ ...manual, checkOutAt: '2025-01-06T06:00:00+03:00' })
      .expect(400);
    await api()
      .post('/staff-attendance')
      .send({
        ...manual,
        date: '2099-01-01',
        checkInAt: '2099-01-01T07:45:00+03:00',
      })
      .expect(400);
    await api()
      .get('/staff-attendance?dateFrom=2025-01-10&dateTo=2025-01-01')
      .expect(400);
    await api().get('/staff-attendance?limit=101').expect(400);
    await api().get('/staff-attendance/staff?role=OWNER').expect(400);
    await api().get('/staff-attendance/summary').expect(400);
    await api().delete('/staff-attendance/not-an-id').expect(400);
  });
});

describe('staff calendar dates', () => {
  it('uses the school date when UTC is still on the previous day', () => {
    expect(
      staffCalendarDate(new Date('2026-09-13T22:30:00Z'), 'Asia/Riyadh'),
    ).toBe('2026-09-14');
  });
  it('handles a timezone west of UTC and daylight saving', () => {
    expect(
      staffCalendarDate(new Date('2026-07-01T02:00:00Z'), 'America/New_York'),
    ).toBe('2026-06-30');
    expect(
      staffCalendarDate(new Date('2026-01-01T04:30:00Z'), 'America/New_York'),
    ).toBe('2025-12-31');
  });
});
