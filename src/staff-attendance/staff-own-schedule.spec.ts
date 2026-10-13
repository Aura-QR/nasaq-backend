import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { StaffAttendance, StaffAttendanceSchema } from './schemas/staff-attendance.schema';
import { StaffLeaveRequest, StaffLeaveRequestSchema } from './schemas/staff-leave-request.schema';
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
import { PermissionsService } from '../permissions/permissions.service';
import { Permission, PermissionSchema } from '../permissions/schemas/permission.schema';
import { JobTitle, JobTitleSchema } from '../permissions/job-titles/job-title.schema';
import { StaffMembersService } from '../managers/staff-members.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { settingsForStaff } from './staff-schedule.util';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-staff-own-schedule${query}`,
);

/**
 * مواهب المملكة: the guard opens the gate at 6:30, half an hour before the
 * school, and was read as late every day he was early. A staff member may
 * now have hours of their own; everyone else keeps the school's.
 */
describe('Staff on hours of their own', () => {
  let moduleRef: TestingModule;
  let attendance: StaffAttendanceService;
  let excuses: StaffAbsenceExcuseService;
  let sweep: StaffAbsenceSweepService;
  const models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const guardId = new Types.ObjectId();
  const cleanerId = new Types.ObjectId();
  const OWNER = { userId: String(ownerId), schoolId: String(schoolId), role: 'OWNER', name: 'المالكة' };
  const GUARD = { userId: String(guardId), schoolId: String(schoolId), role: 'STAFF', name: 'الحارس' };

  const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  /** The school: Sunday to Thursday, 07:00–14:00 Riyadh. */
  const SETTINGS = {
    timezone: 'Asia/Riyadh',
    staffCheckInEnabled: true,
    workSchedule: WEEK.map((day) =>
      ['friday', 'saturday'].includes(day)
        ? { day, isWorkingDay: false, startTime: null, endTime: null }
        : { day, isWorkingDay: true, startTime: '07:00', endTime: '14:00' },
    ),
    holidays: [{ name: 'اليوم الوطني', startDate: '2026-10-03', endDate: '2026-10-03' }],
  };
  /** The guard: 06:30–13:30 on school days, and Saturday mornings. */
  const GUARD_HOURS = [
    ...['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'].map((day) => ({
      day, isWorkingDay: true, startTime: '06:30', endTime: '13:30',
    })),
    { day: 'saturday', isWorkingDay: true, startTime: '07:00', endTime: '12:00' },
  ];

  const SUNDAY = '2026-09-20';
  const SATURDAY = '2026-09-26';
  const HOLIDAY_SATURDAY = '2026-10-03';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const manual = (staffId: any, date: string, checkIn: string, checkOut?: string) =>
    asTenant(() =>
      attendance.createManual(OWNER, {
        staffId: String(staffId),
        date,
        checkInAt: `${date}T${checkIn}:00+03:00`,
        ...(checkOut ? { checkOutAt: `${date}T${checkOut}:00+03:00` } : {}),
      } as any),
    );
  const school = () => models[School.name].collection.findOne({ _id: schoolId });

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
        StaffMembersService,
      ],
    }).compile();
    attendance = moduleRef.get(StaffAttendanceService);
    excuses = moduleRef.get(StaffAbsenceExcuseService);
    sweep = moduleRef.get(StaffAbsenceSweepService);
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
    const mk = (_id: any, username: string, role: string, workSchedule: any[] = []) =>
      models[Admin.name].collection.insertOne({
        _id, username, email: `${username}@x.com`, password: 'x', role, fullName: username,
        permissions: [], workSchedule, schoolId, createdAt: new Date('2026-09-01T00:00:00Z'),
      });
    await mk(ownerId, 'owner', 'OWNER');
    await mk(guardId, 'guard', 'STAFF', GUARD_HOURS);
    await mk(cleanerId, 'cleaner', 'STAFF');
  });

  it('a day of their own replaces the school\'s; the rest, and holidays, stay the school\'s', () => {
    const merged = settingsForStaff(SETTINGS, { workSchedule: [GUARD_HOURS[0]] });
    expect(merged.workSchedule.find((d: any) => d.day === 'sunday').startTime).toBe('06:30');
    expect(merged.workSchedule.find((d: any) => d.day === 'monday').startTime).toBe('07:00');
    expect(merged.holidays).toBe(SETTINGS.holidays);
    expect(settingsForStaff(SETTINGS, { workSchedule: [] })).toBe(SETTINGS);
    expect(settingsForStaff(SETTINGS, null)).toBe(SETTINGS);
  });

  it('lateness and early leave are measured from their own hours', async () => {
    const guard: any = await manual(guardId, SUNDAY, '06:45', '13:00');
    expect(guard.data.lateMinutes).toBe(15);
    expect(guard.data.earlyLeaveMinutes).toBe(30);
    // Somebody on the school's hours is exactly as before.
    const cleaner: any = await manual(cleanerId, SUNDAY, '07:10', '14:00');
    expect(cleaner.data.lateMinutes).toBe(10);
    expect(cleaner.data.earlyLeaveMinutes).toBe(0);
  });

  it('editing a record recomputes it on their own hours', async () => {
    const created: any = await manual(guardId, SUNDAY, '06:30');
    const updated: any = await asTenant(() =>
      attendance.update(OWNER, String(created.data._id), { checkInAt: `${SUNDAY}T06:40:00+03:00` } as any),
    );
    expect(updated.data.lateMinutes).toBe(10);
  });

  it('a Saturday they work is a working day for them only', async () => {
    const guard: any = await manual(guardId, SATURDAY, '07:20');
    expect(guard.data.isWorkingDay).toBe(true);
    expect(guard.data.lateMinutes).toBe(20);
    const cleaner: any = await manual(cleanerId, SATURDAY, '07:20');
    expect(cleaner.data.isWorkingDay).toBe(false);
  });

  it('the absent list on a Saturday has the guard and not the cleaner', async () => {
    const res: any = await asTenant(() => attendance.findAbsent(OWNER, { date: SATURDAY } as any));
    expect(res.isWorkingDay).toBe(true);
    expect(res.absentStaff.map((s: any) => String(s.staffId))).toEqual([String(guardId)]);
  });

  it('a school holiday is off for everyone, their own Saturday included', async () => {
    const res: any = await asTenant(() => attendance.findAbsent(OWNER, { date: HOLIDAY_SATURDAY } as any));
    expect(res.isWorkingDay).toBe(false);
    expect(res.holidayName).toBe('اليوم الوطني');
  });

  it('the monthly report counts each person\'s own working days', async () => {
    const res: any = await asTenant(() =>
      attendance.getSummary(OWNER, { dateFrom: SUNDAY, dateTo: SATURDAY } as any),
    );
    const row = (id: any) => res.data.find((r: any) => String(r.staffId) === String(id));
    expect(res.workingDays).toBe(5);
    expect(row(cleanerId).workingDays).toBe(5);
    expect(row(guardId).workingDays).toBe(6);
    expect(row(guardId).daysAbsent).toBe(6);
  });

  it('the end-of-day notice comes after their own day ends', async () => {
    // Both have used check-in before, so both are asked about a missed day.
    await manual(guardId, '2026-09-17', '06:30');
    await manual(cleanerId, '2026-09-17', '07:00');
    const at = (hhmm: string) => new Date(`${SUNDAY}T${hhmm}:00+03:00`);
    // 14:05: the guard's day ended at 13:30, the school's ends at 14:00.
    expect(await sweep.sweepSchool(await school(), at('14:05'))).toBe(1);
    expect(await models[Notification.name].collection.countDocuments({ recipientId: guardId })).toBe(1);
    // 14:35: now the cleaner's too.
    expect(await sweep.sweepSchool(await school(), at('14:35'))).toBe(1);
    expect(await models[Notification.name].collection.countDocuments({ recipientId: cleanerId })).toBe(1);
  });

  it('the guard is asked about a Saturday he works, and may explain it', async () => {
    await manual(guardId, '2026-09-17', '06:30');
    expect(await sweep.sweepSchool(await school(), new Date(`${SATURDAY}T13:00:00+03:00`))).toBe(1);
    const pending: any = await asTenant(() =>
      excuses.pendingDays(GUARD, 14, new Date(`${SATURDAY}T13:00:00+03:00`)),
    );
    expect(pending.data.map((d: any) => d.date)).toContain(SATURDAY);
    const filed: any = await asTenant(() => excuses.submit(GUARD, { date: SATURDAY, reason: 'مرض' } as any));
    expect(filed.data.status).toBe('pending');
  });

  describe('setting the hours (/staff-members)', () => {
    const staff = () => moduleRef.get(StaffMembersService);
    const patch = (workSchedule: any[]) => asTenant(() => staff().update(String(cleanerId), { workSchedule } as any));

    it('saves and returns them, and [] goes back to the school\'s', async () => {
      const saved: any = await patch([{ day: 'sunday', startTime: '06:00', endTime: '12:00' }]);
      expect(saved.data.workSchedule).toEqual([{ day: 'sunday', isWorkingDay: true, startTime: '06:00', endTime: '12:00' }]);
      const cleared: any = await patch([]);
      expect(cleared.data.workSchedule).toEqual([]);
    });

    it('a day off carries no times', async () => {
      const saved: any = await patch([{ day: 'sunday', isWorkingDay: false, startTime: '06:00', endTime: '12:00' }]);
      expect(saved.data.workSchedule[0]).toEqual({ day: 'sunday', isWorkingDay: false, startTime: null, endTime: null });
    });

    it('refuses a repeated day, half a day\'s times, and an end before the start', async () => {
      await expect(patch([{ day: 'sunday' }, { day: 'sunday' }])).rejects.toBeInstanceOf(BadRequestException);
      await expect(patch([{ day: 'sunday', startTime: '06:00' }])).rejects.toBeInstanceOf(BadRequestException);
      await expect(patch([{ day: 'sunday', startTime: '14:00', endTime: '06:00' }])).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
