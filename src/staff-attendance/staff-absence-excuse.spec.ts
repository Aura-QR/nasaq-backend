import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { StaffAttendance, StaffAttendanceSchema } from './schemas/staff-attendance.schema';
import {
  StaffLeaveRequest,
  StaffLeaveRequestSchema,
} from './schemas/staff-leave-request.schema';
import {
  StaffAbsenceExcuse,
  StaffAbsenceExcuseSchema,
  StaffAbsenceNotice,
  StaffAbsenceNoticeSchema,
} from './schemas/staff-absence-excuse.schema';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAbsenceExcuseService } from './staff-absence-excuse.service';
import { StaffAbsenceSweepService } from './staff-absence-sweep.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { Notification, NotificationSchema } from '../notifications/schemas/notification.schema';
import { DeviceToken, DeviceTokenSchema } from '../notifications/schemas/device-token.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission, PermissionSchema } from '../permissions/schemas/permission.schema';
import { JobTitle, JobTitleSchema } from '../permissions/job-titles/job-title.schema';

// Its own database: suites run in parallel and others clear Admin, School and
// Notification between tests.
const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-staff-absence${query}`,
);

/**
 * Absence excuses for supervisors, managers and service staff.
 *
 * Teachers could explain a missed day; a supervisor or a guard could not.
 * And a cleaner may have no phone at all, so the school also enters excuses
 * for them, accepted as written.
 */
describe('Staff absence excuses', () => {
  let moduleRef: TestingModule;
  let excuses: StaffAbsenceExcuseService;
  let sweep: StaffAbsenceSweepService;
  let attendance: StaffAttendanceService;
  const models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const managerId = new Types.ObjectId();
  const supervisorId = new Types.ObjectId();
  const cleanerId = new Types.ObjectId();
  const newcomerId = new Types.ObjectId(); // never checked in

  const OWNER = { userId: String(ownerId), schoolId: String(schoolId), role: 'OWNER', name: 'المالكة' };
  const MANAGER = { userId: String(managerId), schoolId: String(schoolId), role: 'MANAGER', name: 'أ. هدى' };
  const SUPERVISOR = { userId: String(supervisorId), schoolId: String(schoolId), role: 'SUPERVISOR', name: 'أ. بشاير' };
  const CLEANER = { userId: String(cleanerId), schoolId: String(schoolId), role: 'STAFF', name: 'أم محمد' };

  /** Every day a working day, 07:00–13:00 Riyadh. */
  const SETTINGS = {
    timezone: 'Asia/Riyadh',
    staffCheckInEnabled: true,
    workSchedule: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      .map((day) => ({ day, isWorkingDay: true, startTime: '07:00', endTime: '13:00' })),
  };

  const ABSENT_DAY = '2026-09-27';
  const PRESENT_DAY = '2026-09-28';
  const FIRST_DAY = '2026-09-20';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

  const checkIn = (staffId: any, d: string, role = 'SUPERVISOR') =>
    models[StaffAttendance.name].collection.insertOne({
      staffId, role, name: 'x', date: day(d),
      checkInAt: new Date(`${d}T04:00:00.000Z`), method: 'manual', schoolId,
    });

  const notices = (recipientId: any, type: string) =>
    models[Notification.name].collection.find({ recipientId, type }).toArray();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Admin.name, schema: AdminSchema },
          { name: School.name, schema: SchoolSchema },
          { name: StaffAttendance.name, schema: StaffAttendanceSchema },
          { name: StaffLeaveRequest.name, schema: StaffLeaveRequestSchema },
          { name: StaffAbsenceExcuse.name, schema: StaffAbsenceExcuseSchema },
          { name: StaffAbsenceNotice.name, schema: StaffAbsenceNoticeSchema },
          { name: Notification.name, schema: NotificationSchema },
          { name: DeviceToken.name, schema: DeviceTokenSchema },
          { name: Permission.name, schema: PermissionSchema },
          { name: JobTitle.name, schema: JobTitleSchema },
        ]),
      ],
      providers: [
        PermissionsService,
        StaffAttendanceService,
        StaffAbsenceExcuseService,
        StaffAbsenceSweepService,
        NotificationsService,
        PushService,
      ],
    }).compile();

    excuses = moduleRef.get(StaffAbsenceExcuseService);
    sweep = moduleRef.get(StaffAbsenceSweepService);
    attendance = moduleRef.get(StaffAttendanceService);
    for (const name of [
      Admin.name, School.name, StaffAttendance.name, StaffAbsenceExcuse.name,
      StaffAbsenceNotice.name, Notification.name, Permission.name,
    ]) {
      models[name] = moduleRef.get(getModelToken(name));
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(models)) await model.collection.deleteMany({});

    await models[School.name].collection.insertOne({
      _id: schoolId, name: 'مدرسة الاختبار', slug: `qa-${String(schoolId)}`, settings: SETTINGS,
    });

    const created = day('2026-09-01');
    const mkAdmin = (_id: any, username: string, role: string, fullName = '') =>
      models[Admin.name].collection.insertOne({
        _id, username, email: `${username}@x.com`, password: 'x', role, fullName,
        permissions: [], schoolId, createdAt: created,
      });
    await mkAdmin(ownerId, 'owner', 'OWNER', 'المالكة');
    await mkAdmin(managerId, 'mgr', 'MANAGER', 'أ. هدى');
    await mkAdmin(supervisorId, 'sup', 'SUPERVISOR', 'أ. بشاير');
    await mkAdmin(cleanerId, 'cleaner', 'STAFF', 'أم محمد');
    await mkAdmin(newcomerId, 'new', 'STAFF', 'جديد');

    // Supervisor and cleaner use check-in, and were in on PRESENT_DAY.
    await checkIn(supervisorId, FIRST_DAY);
    await checkIn(supervisorId, PRESENT_DAY);
    await checkIn(cleanerId, FIRST_DAY, 'STAFF');
  });

  const submit = (user: any, d = ABSENT_DAY, reason = 'وعكة صحية') =>
    asTenant(() => excuses.submit(user, { date: d, reason }));

  const record = (user: any, staffId: any, d = ABSENT_DAY, reason = 'اتصلت صباحًا: مرض ابنها') =>
    asTenant(() => excuses.record(user, { staffId: String(staffId), date: d, reason }));

  describe('a staff member explaining their own absence', () => {
    it('saves it as pending and tells the school, not themself', async () => {
      const res: any = await submit(SUPERVISOR);
      expect(res.data.status).toBe('pending');

      expect(await notices(ownerId, 'staff_absence_excuse_submitted')).toHaveLength(1);
      expect(await notices(supervisorId, 'staff_absence_excuse_submitted')).toHaveLength(0);
    });

    it('a manager hears only if the permissions screen lets her see staff attendance', async () => {
      // The default MANAGER row denies staffAttendance.
      await submit(SUPERVISOR);
      expect(await notices(managerId, 'staff_absence_excuse_submitted')).toHaveLength(0);

      await models[Permission.name].collection.insertOne({
        role: 'MANAGER', schoolId, userId: null,
        permissions: { staffAttendance: { read: true, add: false, edit: true, delete: false } },
      });
      await submit(CLEANER);
      expect(await notices(managerId, 'staff_absence_excuse_submitted')).toHaveLength(1);
    });

    it('works for a guard or cleaner too', async () => {
      const res: any = await submit(CLEANER);
      expect(res.data.status).toBe('pending');
    });

    it('refuses the owner, who is not staff', async () => {
      await expect(submit(OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a day that has not come yet', async () => {
      await expect(submit(SUPERVISOR, '2099-01-01')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a day they checked in', async () => {
      await expect(submit(SUPERVISOR, PRESENT_DAY)).rejects.toThrow(/عذر التأخير/);
    });

    it('refuses a holiday', async () => {
      await models[School.name].collection.updateOne(
        { _id: schoolId },
        { $set: { 'settings.holidays': [{ name: 'اليوم الوطني', startDate: day(ABSENT_DAY), endDate: day(ABSENT_DAY) }] } },
      );
      await expect(submit(SUPERVISOR)).rejects.toThrow(/ليس يوم عمل/);
    });

    it('refuses a second excuse for the same day', async () => {
      await submit(SUPERVISOR);
      await expect(submit(SUPERVISOR)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('the school entering an excuse for somebody', () => {
    it('records it as accepted, says who entered it, and tells the person', async () => {
      const res: any = await record(OWNER, cleanerId);

      expect(res.data).toMatchObject({
        status: 'accepted',
        staffName: 'أم محمد',
        role: 'STAFF',
        enteredBySchool: true,
        recordedByName: 'المالكة',
        reviewedByName: 'المالكة',
      });
      const told = await notices(cleanerId, 'staff_absence_excuse_reviewed');
      expect(told).toHaveLength(1);
      expect(told[0].title).toBe('سُجِّل عذر غيابك');
    });

    it('does not let anyone enter an excuse for themself', async () => {
      await expect(record(SUPERVISOR, supervisorId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only for staff of this school — not the owner or an unknown id', async () => {
      await expect(record(SUPERVISOR, ownerId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(record(OWNER, new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not overwrite an excuse the person already sent', async () => {
      await submit(CLEANER);
      await expect(record(OWNER, cleanerId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('runs the same day checks', async () => {
      await expect(record(OWNER, supervisorId, PRESENT_DAY)).rejects.toThrow(/عذر التأخير/);
      await expect(record(OWNER, cleanerId, '2099-01-01')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reviewing', () => {
    let excuseId: string;
    beforeEach(async () => {
      excuseId = ((await submit(SUPERVISOR)) as any).data.id;
    });

    const review = (user: any, dto: any) => asTenant(() => excuses.review(user, excuseId, dto));

    it('accepts and tells the person', async () => {
      const res: any = await review(OWNER, { verdict: 'accepted' });
      expect(res.data.status).toBe('accepted');
      const told = await notices(supervisorId, 'staff_absence_excuse_reviewed');
      expect(told[0].title).toBe('تم قبول عذر الغياب');
    });

    it('requires a reason to reject', async () => {
      await expect(review(OWNER, { verdict: 'rejected' })).rejects.toThrow(/سبب رفض/);
      const res: any = await review(OWNER, { verdict: 'rejected', note: 'لم يُرفق تقرير' });
      expect(res.data).toMatchObject({ status: 'rejected', reviewNote: 'لم يُرفق تقرير' });
    });

    it('does not let anyone rule on their own', async () => {
      await expect(review(SUPERVISOR, { verdict: 'accepted' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rules once', async () => {
      await review(OWNER, { verdict: 'accepted' });
      await expect(review(MANAGER, { verdict: 'rejected', note: 'x' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('marking present records attendance at the day start and closes the excuse', async () => {
      const res: any = await asTenant(() => excuses.markPresent(OWNER, excuseId, undefined, 'مهمة خارجية'));
      expect(res.data.status).toBe('marked_present');

      const rec = await models[StaffAttendance.name].collection.findOne({
        staffId: supervisorId, date: day(ABSENT_DAY),
      });
      expect(rec).toBeTruthy();
      expect(rec.method).toBe('manual');
      // 07:00 Riyadh is 04:00 UTC; no lateness for a day agreed as present.
      expect(new Date(rec.checkInAt).toISOString()).toBe(`${ABSENT_DAY}T04:00:00.000Z`);
      expect(rec.lateMinutes).toBe(0);
    });
  });

  describe('lists', () => {
    it('the queue is pending by default; school-entered ones are under accepted', async () => {
      await submit(SUPERVISOR);
      await record(OWNER, cleanerId);

      const pending: any = await asTenant(() => excuses.list(OWNER, {}));
      expect(pending.data.map((r: any) => r.staffName)).toEqual(['أ. بشاير']);

      const accepted: any = await asTenant(() => excuses.list(OWNER, { status: 'accepted' }));
      expect(accepted.data).toHaveLength(1);
      expect(accepted.data[0]).toMatchObject({ staffName: 'أم محمد', enteredBySchool: true });
    });

    it('a person sees their own excuses, including those the school entered', async () => {
      await record(OWNER, cleanerId);
      const mine: any = await asTenant(() => excuses.mine(CLEANER));
      expect(mine.data).toHaveLength(1);
      expect(mine.data[0].status).toBe('accepted');
    });
  });

  describe('the days still to explain', () => {
    // 2026-09-30, 10:00 Riyadh — the day has not ended yet.
    const MORNING = new Date('2026-09-30T07:00:00.000Z');
    const pending = (user: any, at = MORNING) =>
      asTenant(() => excuses.pendingDays(user, 14, at)) as Promise<any>;

    it('lists working days since the first check-in with no record and no excuse', async () => {
      await submit(SUPERVISOR); // explains ABSENT_DAY
      const res = await pending(SUPERVISOR);
      const dates = res.data.map((d: any) => d.date);

      expect(dates).not.toContain(ABSENT_DAY);   // explained
      expect(dates).not.toContain(PRESENT_DAY);  // present
      expect(dates).not.toContain(FIRST_DAY);    // present
      expect(dates).not.toContain('2026-09-30'); // today, not over yet
      expect(dates).not.toContain('2026-09-19'); // before the first check-in
      expect(dates).toContain('2026-09-29');
      expect(dates[0]).toBe('2026-09-29');       // newest first
    });

    it('counts today once the day is over', async () => {
      const res = await pending(SUPERVISOR, new Date('2026-09-30T11:00:00.000Z')); // 14:00
      expect(res.data.map((d: any) => d.date)).toContain('2026-09-30');
    });

    it('is empty for somebody who never checked in', async () => {
      const res = await pending({ ...CLEANER, userId: String(newcomerId) });
      expect(res.data).toEqual([]);
    });

    it('is empty when the school does not use staff check-in', async () => {
      await models[School.name].collection.updateOne(
        { _id: schoolId }, { $set: { 'settings.staffCheckInEnabled': false } },
      );
      expect((await pending(SUPERVISOR)).data).toEqual([]);
    });
  });

  describe('the end-of-day notice', () => {
    const school = () => models[School.name].collection.findOne({ _id: schoolId });
    // 2026-09-29: 13:45 Riyadh — 45 minutes after the day ended.
    const AFTER = new Date('2026-09-29T10:45:00.000Z');

    it('asks everyone absent who uses check-in, once', async () => {
      await checkIn(managerId, FIRST_DAY, 'MANAGER');
      await checkIn(managerId, '2026-09-29', 'MANAGER'); // the manager came in

      expect(await sweep.sweepSchool(await school(), AFTER)).toBe(2);
      expect(await notices(supervisorId, 'staff_absence_excuse_required')).toHaveLength(1);
      expect(await notices(cleanerId, 'staff_absence_excuse_required')).toHaveLength(1);
      expect(await notices(managerId, 'staff_absence_excuse_required')).toHaveLength(0);
      expect(await notices(newcomerId, 'staff_absence_excuse_required')).toHaveLength(0);
      expect(await notices(ownerId, 'staff_absence_excuse_required')).toHaveLength(0);

      // A second run sends nothing more.
      expect(await sweep.sweepSchool(await school(), AFTER)).toBe(0);
    });

    it('waits until half an hour after the day ends', async () => {
      const early = new Date('2026-09-29T10:15:00.000Z'); // 13:15
      expect(await sweep.sweepSchool(await school(), early)).toBe(0);
    });

    it('skips somebody whose excuse is already on file', async () => {
      await record(OWNER, cleanerId, '2026-09-29');
      await sweep.sweepSchool(await school(), AFTER);
      expect(await notices(cleanerId, 'staff_absence_excuse_required')).toHaveLength(0);
    });

    it('sends nothing for a school without staff check-in', async () => {
      const s = await school();
      expect(await sweep.sweepSchool({ ...s, settings: { ...s.settings, staffCheckInEnabled: false } }, AFTER)).toBe(0);
    });
  });

  it('the monthly summary shows excused days beside the absences', async () => {
    await record(OWNER, cleanerId);
    const summary: any = await asTenant(() =>
      attendance.getSummary(OWNER, { dateFrom: '2026-09-20', dateTo: '2026-09-29' } as any),
    );
    const row = summary.data.find((r: any) => String(r.staffId) === String(cleanerId));
    expect(row.daysExcused).toBe(1);
    expect(row.daysAbsent).toBe(9); // unchanged by the excuse
  });
});
