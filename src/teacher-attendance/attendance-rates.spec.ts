import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Connection, Types } from 'mongoose';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { TeacherAttendance, TeacherAttendanceSchema } from './schemas/teacher-attendance.schema';
import {
  TeacherAbsenceExcuse,
  TeacherAbsenceExcuseSchema,
} from './schemas/teacher-absence-excuse.schema';
import {
  TeacherAbsenceNotice,
  TeacherAbsenceNoticeSchema,
} from './schemas/teacher-absence-notice.schema';
import { UpdateSchoolSettingsDto } from '../platform/schools/dto/update-school-settings.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { TeacherAttendanceService } from './teacher-attendance.service';
import { TeacherAbsenceExcuseService } from './teacher-absence-excuse.service';
import { TeacherAbsenceSweepService } from './teacher-absence-sweep.service';
import { TeacherAttendanceController } from './teacher-attendance.controller';
import { byWeekday, pooledRates, rateOf, rowRates } from './attendance-rates.util';

/**
 * Teacher attendance as percentages: per teacher, school-wide, per day, the
 * teacher's own «حضوري», and حد غياب المعلمين.
 *
 * The school works Sunday to Thursday, Riyadh time, the day ending at 13:00.
 * 22–23 September 2026 are a holiday, which leaves 20 working days in
 * September. Haya works Sunday, Monday and Tuesday only: 12 of them.
 */

describe('attendance rates: pure arithmetic', () => {
  it('rounds to one decimal and has no rate without a denominator', () => {
    expect(rateOf(15, 18)).toBe(83.3);
    expect(rateOf(8, 9)).toBe(88.9);
    expect(rateOf(0, 0)).toBeNull();
  });

  it('pools, not averages', () => {
    const rows = [
      { workingDays: 20, daysAbsent: 2, daysPresent: 18, daysLate: 3, daysLatenessNotTracked: 0 },
      { workingDays: 20, daysAbsent: 0, daysPresent: 20, daysLate: 0, daysLatenessNotTracked: 0 },
      { workingDays: 12, daysAbsent: 3, daysPresent: 9, daysLate: 1, daysLatenessNotTracked: 0 },
    ];
    expect(pooledRates(rows)).toEqual({ attendanceRate: 90.4, punctualityRate: 91.5 });
  });

  it('a teacher with no tracked day has no punctuality, not 100', () => {
    expect(
      rowRates({ workingDays: 5, daysAbsent: 0, daysPresent: 5, daysLate: 0, daysLatenessNotTracked: 5 }),
    ).toEqual({ attendanceRate: 100, punctualityRate: null });
  });

  it('byWeekday lists only weekdays that appear, Sunday first', () => {
    const out = byWeekday([
      { date: '2026-09-03', expected: 10, present: 8, late: 0, absent: 2, absentExcused: 0, attendanceRate: 80, punctualityRate: 100 },
      { date: '2026-09-06', expected: 10, present: 10, late: 1, absent: 0, absentExcused: 0, attendanceRate: 100, punctualityRate: 90 },
      { date: '2026-09-10', expected: 10, present: 9, late: 0, absent: 1, absentExcused: 0, attendanceRate: 90, punctualityRate: 100 },
    ]);
    expect(out.map((d) => d.weekday)).toEqual(['sunday', 'thursday']);
    expect(out[1]).toEqual({ weekday: 'thursday', days: 2, attendanceRate: 85, punctualityRate: 100 });
  });
});

describe('حد غياب المعلمين: the settings DTO', () => {
  const check = async (value: any) =>
    validate(plainToInstance(UpdateSchoolSettingsDto, { teacherAbsenceAlertDays: value }));

  it.each([0, 61, 2.5])('rejects %p', async (value) => {
    const errors = await check(value);
    expect(errors.map((e) => e.property)).toContain('teacherAbsenceAlertDays');
    expect(JSON.stringify(errors)).toContain('حد غياب المعلمين');
  });

  it.each([null, 1, 60])('accepts %p', async (value) => {
    expect(await check(value)).toHaveLength(0);
  });
});

describe('me/stats: who may call it', () => {
  const guard = new RolesGuard(new Reflector());
  const ctx = (role: string) =>
    ({
      getHandler: () => TeacherAttendanceController.prototype.getMyStats,
      getClass: () => TeacherAttendanceController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as any;

  it('lets a teacher in and keeps an owner out (403)', () => {
    expect(guard.canActivate(ctx('TEACHER'))).toBe(true);
    // RolesGuard returning false is Nest's 403.
    expect(guard.canActivate(ctx('OWNER'))).toBe(false);
    expect(guard.canActivate(ctx('MANAGER'))).toBe(false);
    void ForbiddenException;
  });

  it('is declared above me and every :id route', () => {
    const names = Object.getOwnPropertyNames(TeacherAttendanceController.prototype);
    expect(names.indexOf('getMyStats')).toBeLessThan(names.indexOf('getMyAttendance'));
    expect(names.indexOf('getMyStats')).toBeLessThan(names.indexOf('update'));
    expect(names.indexOf('getToday')).toBeLessThan(names.indexOf('update'));
  });
});

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-teacher-rates${query}`,
);

describe('attendance rates: from the database', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const supervisorId = new Types.ObjectId();
  const noura = new Types.ObjectId();
  const sara = new Types.ObjectId();
  const haya = new Types.ObjectId();
  const owner = { role: 'OWNER', userId: String(ownerId), schoolId: String(schoolId) };
  const asSchool = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(
    (day) => {
      const working = !['friday', 'saturday'].includes(day);
      return {
        day,
        isWorkingDay: working,
        startTime: working ? '06:45' : null,
        endTime: working ? '13:00' : null,
      };
    },
  );
  const d = (label: string) => new Date(`${label}T00:00:00.000Z`);
  const riyadh = (date: string, time: string) => new Date(`${date}T${time}:00.000+03:00`);
  /** After the whole period, so nothing in September is "today". */
  const LATER = riyadh('2026-11-26', '09:00');

  /** The 20 working days of September 2026 (22–23 are a holiday). */
  const SEPT = [
    '01', '02', '03', '06', '07', '08', '09', '10', '13', '14', '15', '16', '17',
    '20', '21', '24', '27', '28', '29', '30',
  ].map((x) => `2026-09-${x}`);
  const SUN_MON_TUE = new Set([0, 1, 2]);
  const HAYA_DAYS = SEPT.filter((x) => SUN_MON_TUE.has(d(x).getUTCDay()));

  let notify: jest.Mock;
  let service: TeacherAttendanceService;
  let sweep: TeacherAbsenceSweepService;

  const settings = (over: any = {}) => ({
    teacherCheckInEnabled: true,
    location: { lat: 24.7, lng: 46.7 },
    timezone: 'Asia/Riyadh',
    workSchedule: WEEK,
    holidays: [{ name: 'اليوم الوطني', startDate: d('2026-09-22'), endDate: d('2026-09-23') }],
    teacherAbsenceAlertDays: 3,
    ...over,
  });

  const setSettings = (over: any) =>
    m[School.name].collection.updateOne(
      { _id: schoolId },
      { $set: Object.fromEntries(Object.entries(over).map(([k, v]) => [`settings.${k}`, v])) },
    );

  const teacher = (_id: Types.ObjectId, name: string, over: any = {}) =>
    m[Teacher.name].collection.insertOne({
      _id,
      name,
      email: `${String(_id)}@t.sa`,
      isActive: true,
      workDays: [],
      schoolId,
      ...over,
    });

  const present = (teacherId: Types.ObjectId, date: string, lateMinutes: number | null = 0, over: any = {}) =>
    m[TeacherAttendance.name].collection.insertOne({
      teacherId,
      date: d(date),
      checkInAt: riyadh(date, '06:40'),
      method: 'location',
      isWorkingDay: true,
      lateMinutes,
      earlyLeaveMinutes: 0,
      checkOutAt: riyadh(date, '13:05'),
      schoolId,
      ...over,
    });

  const excuse = (teacherId: Types.ObjectId, date: string, status = 'accepted') =>
    m[TeacherAbsenceExcuse.name].collection.insertOne({
      teacherId,
      date: d(date),
      reason: 'مرض',
      status,
      schoolId,
    });

  /** The scenario from the spec: Noura, Sara and Haya over September. */
  const seedScenario = async () => {
    await teacher(noura, 'نورة');
    await teacher(sara, 'سارة');
    await teacher(haya, 'هيا', { workDays: ['sunday', 'monday', 'tuesday'] });

    // Noura: absent 10th (excused) and 17th; late on three days.
    const nouraAbsent = new Set(['2026-09-10', '2026-09-17']);
    const nouraLate = new Set(['2026-09-02', '2026-09-08', '2026-09-28']);
    for (const day of SEPT) {
      if (!nouraAbsent.has(day)) await present(noura, day, nouraLate.has(day) ? 12 : 0);
    }
    await excuse(noura, '2026-09-10');

    // Sara: every day, on time.
    for (const day of SEPT) await present(sara, day, 0);

    // Haya: her own 12 days, absent on the 13th, 14th and 15th; late once.
    const hayaAbsent = new Set(['2026-09-13', '2026-09-14', '2026-09-15']);
    for (const day of HAYA_DAYS) {
      if (!hayaAbsent.has(day)) await present(haya, day, day === '2026-09-01' ? 7 : 0);
    }
    // A Thursday she came in on her day off: real, but she was not expected.
    await present(haya, '2026-09-03', 0);
  };

  const summary = (dateFrom: string, dateTo: string, now: Date = LATER, extra: any = {}) =>
    asSchool(() => service.getMonthlySummary({ dateFrom, dateTo, ...extra } as any, owner, { now }));

  const rowOf = (res: any, id: Types.ObjectId) =>
    res.data.find((r: any) => String(r.teacherId) === String(id));

  beforeAll(async () => {
    const models = [
      [School.name, SchoolSchema],
      [AcademicYear.name, AcademicYearSchema],
      [Term.name, TermSchema],
      [Teacher.name, TeacherSchema],
      [Admin.name, AdminSchema],
      [TeacherAttendance.name, TeacherAttendanceSchema],
      [TeacherAbsenceExcuse.name, TeacherAbsenceExcuseSchema],
      [TeacherAbsenceNotice.name, TeacherAbsenceNoticeSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
    await m[TeacherAbsenceNotice.name].init();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as any;
    const excuses = new TeacherAbsenceExcuseService(
      m[TeacherAbsenceExcuse.name],
      m[TeacherAttendance.name],
      m[Teacher.name],
      m[School.name],
      m[Admin.name],
      notifications,
    );
    service = new TeacherAttendanceService(
      m[TeacherAttendance.name],
      m[Teacher.name],
      m[School.name],
      {} as any,
      m[Admin.name],
      notifications,
      excuses,
    );
    sweep = new TeacherAbsenceSweepService(
      m[School.name],
      m[Teacher.name],
      m[TeacherAttendance.name],
      m[TeacherAbsenceExcuse.name],
      m[TeacherAbsenceNotice.name],
      notifications,
      service,
    );

    await m[School.name].collection.insertOne({
      _id: schoolId,
      name: 'مدرسة',
      slug: `s${Math.random()}`,
      email: 'a@b.c',
      subscriptionStatus: 'active',
      isActive: true,
      settings: settings(),
    });
    await m[AcademicYear.name].collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    await m[Term.name].collection.insertOne({
      _id: termId,
      academicYearId: yearId,
      name: 'الترم الأول',
      order: 1,
      startDate: d('2026-09-01'),
      endDate: d('2026-12-31'),
      status: 'active',
      schoolId,
    });
    await m[Admin.name].collection.insertMany([
      { _id: ownerId, name: 'المالكة', role: 'OWNER', schoolId, email: 'o@s.sa', username: 'owner' },
      { _id: supervisorId, name: 'المشرفة', role: 'SUPERVISOR', schoolId, email: 's@s.sa', username: 'super' },
    ]);
  });

  // ─────────────────────────────────────────── 1. the scenario

  it('1. gives the spec’s rates per teacher and pooled overview', async () => {
    await seedScenario();
    const res: any = await summary('2026-09-01', '2026-09-30');

    expect(res.workingDays).toBe(20);
    expect(rowOf(res, noura)).toMatchObject({
      workingDays: 20, daysAbsent: 2, daysAbsentExcused: 1, daysAbsentUnexcused: 1,
      attendanceRate: 90, punctualityRate: 83.3, overLimit: false,
    });
    expect(rowOf(res, sara)).toMatchObject({
      workingDays: 20, daysAbsent: 0, attendanceRate: 100, punctualityRate: 100, overLimit: false,
    });
    // Measured against her own 12 days; the day-off Thursday does not cover one.
    expect(rowOf(res, haya)).toMatchObject({
      workingDays: 12, daysAbsent: 3, daysAbsentUnexcused: 3, attendanceRate: 75, overLimit: true,
    });

    expect(res.overview).toMatchObject({
      attendanceRate: 90.4,
      totalAbsentDays: 5,
      totalAbsentExcused: 1,
      totalAbsentUnexcused: 4,
      perfectAttendanceCount: 1,
      teacherAbsenceAlertDays: 3,
      overLimitCount: 1,
    });
    expect(res.overview.overLimit).toEqual([
      { teacherId: haya, teacherName: 'هيا', daysAbsentUnexcused: 3, daysAbsent: 3 },
    ]);
    // Internal sets never reach the response.
    expect(rowOf(res, noura)).not.toHaveProperty('presentDates');
    expect(rowOf(res, noura)).not.toHaveProperty('lateDates');
  });

  it('1b. Haya’s punctuality is 8/9 once her day-off check-in is set aside', async () => {
    await seedScenario();
    await m[TeacherAttendance.name].collection.deleteOne({ teacherId: haya, date: d('2026-09-03') });
    const res: any = await summary('2026-09-01', '2026-09-30');
    expect(rowOf(res, haya).punctualityRate).toBe(88.9);
    expect(res.overview.punctualityRate).toBe(91.5);
  });

  // ─────────────────────────────────────────── 2. lateness not tracked

  it('2. punctuality skips days with no lateness measured; none measured is null', async () => {
    await teacher(noura, 'نورة');
    await teacher(sara, 'سارة');
    // Noura: 2 measured days (1 late) and 2 unmeasured.
    await present(noura, '2026-09-01', 10);
    await present(noura, '2026-09-02', 0);
    await present(noura, '2026-09-03', null);
    await present(noura, '2026-09-06', null);
    // Sara: nothing measured at all.
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-06']) {
      await present(sara, day, null);
    }
    const res: any = await summary('2026-09-01', '2026-09-06');
    expect(rowOf(res, noura).punctualityRate).toBe(50);
    expect(rowOf(res, sara).punctualityRate).toBeNull();
    expect(rowOf(res, sara).attendanceRate).toBe(100);
    expect(res.overview.punctualityRate).toBe(50);
  });

  // ─────────────────────────────────────────── 3. deleted / inactive

  it('3. deleted and inactive teachers stay in data[] but not in the overview', async () => {
    await seedScenario();
    const gone = new Types.ObjectId();
    const resting = new Types.ObjectId();
    await teacher(resting, 'ريم', { isActive: false });
    for (const day of SEPT.slice(0, 5)) {
      await present(gone, day, 30, { name: 'محذوفة' });
      await present(resting, day, 30);
    }

    const res: any = await summary('2026-09-01', '2026-09-30');
    expect(rowOf(res, gone)).toMatchObject({ teacherDeleted: true });
    expect(rowOf(res, resting)).toBeDefined();
    expect(res.data).toHaveLength(5);
    // Unchanged by the two extra rows.
    expect(res.overview).toMatchObject({
      attendanceRate: 90.4,
      totalAbsentDays: 5,
      perfectAttendanceCount: 1,
      overLimitCount: 1,
    });
    expect(res.overview.daily.reduce((n: number, x: any) => n + x.expected, 0)).toBe(52);
  });

  // ─────────────────────────────────────────── 4. no limit

  it('4. with no limit, overLimit and overLimitCount are null', async () => {
    await seedScenario();
    await setSettings({ teacherAbsenceAlertDays: null });
    const res: any = await summary('2026-09-01', '2026-09-30');
    expect(rowOf(res, haya).overLimit).toBeNull();
    expect(res.overview).toMatchObject({
      teacherAbsenceAlertDays: null, overLimitCount: null, overLimit: null,
    });
  });

  // ─────────────────────────────────────────── 5. today

  it('5. today is not an absence until the school day ends', async () => {
    // Thu 1 Oct and Sun 4 Oct are the working days; it is Sunday the 4th.
    await teacher(noura, 'نورة');
    await teacher(sara, 'سارة');
    await present(noura, '2026-10-01');
    await present(noura, '2026-10-04');
    await present(sara, '2026-10-01');

    const morning: any = await summary('2026-10-01', '2026-10-04', riyadh('2026-10-04', '07:30'));
    expect(morning.todayInProgress).toBe(true);
    expect(morning.workingDays).toBe(1);
    expect(rowOf(morning, sara)).toMatchObject({ daysAbsent: 0, absentDates: [], attendanceRate: 100 });
    // Her check-in this morning does not push the earlier days negative.
    expect(rowOf(morning, noura)).toMatchObject({ daysAbsent: 0, attendanceRate: 100, daysPresent: 2 });
    expect(morning.overview.daily.map((x: any) => x.date)).toEqual(['2026-10-01']);

    const afternoon: any = await summary('2026-10-01', '2026-10-04', riyadh('2026-10-04', '14:30'));
    expect(afternoon.todayInProgress).toBe(false);
    expect(afternoon.workingDays).toBe(2);
    expect(rowOf(afternoon, sara)).toMatchObject({
      daysAbsent: 1,
      absentDates: [{ date: '2026-10-04', excused: false }],
      attendanceRate: 50,
    });
    expect(afternoon.overview.daily.map((x: any) => x.date)).toEqual(['2026-10-01', '2026-10-04']);
  });

  it('5b. days after today are never absences', async () => {
    await teacher(sara, 'سارة');
    await present(sara, '2026-10-01');
    const res: any = await summary('2026-10-01', '2026-10-31', riyadh('2026-10-01', '14:00'));
    expect(res.workingDays).toBe(1);
    expect(rowOf(res, sara)).toMatchObject({ daysAbsent: 0, attendanceRate: 100 });
  });

  // ─────────────────────────────────────────── 6. the sweep

  describe('6. the sweep and حد غياب المعلمين', () => {
    const huda = new Types.ObjectId();
    const school = async () => m[School.name].collection.findOne({ _id: schoolId });
    const limitAlerts = () =>
      notify.mock.calls.map((c) => c[0]).filter((n) => n.type === 'teacher_absence_limit_reached');

    beforeEach(async () => {
      // Term from 1 Oct. Huda came in on the 1st and the 4th, then stopped.
      await m[Term.name].collection.updateOne({ _id: termId }, { $set: { startDate: d('2026-10-01') } });
      await teacher(huda, 'هدى');
      await present(huda, '2026-10-01');
      await present(huda, '2026-10-04');
    });

    it('the 3rd unexcused day alerts each admin once; the 4th does not', async () => {
      await sweep.sweepSchool(await school(), riyadh('2026-10-05', '13:45'));
      await sweep.sweepSchool(await school(), riyadh('2026-10-06', '13:45'));
      expect(limitAlerts()).toHaveLength(0);

      await sweep.sweepSchool(await school(), riyadh('2026-10-07', '13:45'));
      const alerts = limitAlerts();
      expect(alerts.map((a) => String(a.recipientId)).sort()).toEqual(
        [String(ownerId), String(supervisorId)].sort(),
      );
      // Not the teacher: she was already asked for an excuse.
      expect(alerts.some((a) => String(a.recipientId) === String(huda))).toBe(false);
      expect(alerts[0]).toMatchObject({
        title: 'تنبيه: بلوغ حد غياب معلمة',
        body: 'بلغ غياب هدى بغير عذر مقبول 3 أيام في الترم الأول، وهو حد الغياب المعتمد للمعلمين.',
        data: {
          teacherId: String(huda), teacherName: 'هدى', unexcusedDays: 3, limit: 3,
          termName: 'الترم الأول', date: '2026-10-07',
        },
      });

      // A re-run on the same day sends nothing new.
      await sweep.sweepSchool(await school(), riyadh('2026-10-07', '15:00'));
      expect(limitAlerts()).toHaveLength(2);

      // The 4th day: past the limit, no repeat.
      await sweep.sweepSchool(await school(), riyadh('2026-10-08', '13:45'));
      expect(limitAlerts()).toHaveLength(2);
      // She is still asked about each day, as before.
      expect(notify.mock.calls.filter((c) => c[0].type === 'teacher_absence_excuse_required')).toHaveLength(4);
    });

    it('an accepted excuse keeps the count below the limit', async () => {
      await excuse(huda, '2026-10-05');
      for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
        await sweep.sweepSchool(await school(), riyadh(day, '13:45'));
      }
      expect(limitAlerts()).toHaveLength(0);
    });

    it('sends nothing with the limit off', async () => {
      await setSettings({ teacherAbsenceAlertDays: null });
      for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
        await sweep.sweepSchool(await school(), riyadh(day, '13:45'));
      }
      expect(limitAlerts()).toHaveLength(0);
    });

    it('a failing limit check never breaks the sweep', async () => {
      jest.spyOn(service as any, 'getMonthlySummary').mockRejectedValue(new Error('boom'));
      const sent = await sweep.sweepSchool(await school(), riyadh('2026-10-05', '13:45'));
      expect(sent).toBe(1);
    });
  });

  // ─────────────────────────────────────────── 7. me/stats

  describe('7. me/stats', () => {
    const asTeacher = (id: Types.ObjectId) => ({ role: 'TEACHER', userId: String(id), schoolId: String(schoolId) });

    it('gives a teacher her own numbers only', async () => {
      await seedScenario();
      const res: any = await asSchool(() =>
        service.getMyStats(asTeacher(noura), { dateFrom: '2026-09-01', dateTo: '2026-09-30' }, LATER),
      );
      expect(res.data).toMatchObject({
        dateFrom: '2026-09-01', dateTo: '2026-09-30',
        workingDays: 20, daysPresent: 18, daysAbsent: 2, daysAbsentExcused: 1, daysAbsentUnexcused: 1,
        daysLate: 3, totalLateMinutes: 36, attendanceRate: 90, punctualityRate: 83.3,
        teacherAbsenceAlertDays: 3, overLimit: false,
        absentDates: [{ date: '2026-09-10', excused: true }, { date: '2026-09-17', excused: false }],
      });
    });

    it('defaults to the current term up to today', async () => {
      await seedScenario();
      const res: any = await asSchool(() => service.getMyStats(asTeacher(sara), {}, LATER));
      expect(res.data).toMatchObject({
        dateFrom: '2026-09-01',
        dateTo: '2026-11-26',
        term: { _id: String(termId), name: 'الترم الأول' },
      });
      // Today (Thursday the 26th, 09:00) is not yet part of the period.
      expect(res.data.todayInProgress).toBe(true);
    });

    it('without a term, the last 30 days', async () => {
      await m[Term.name].collection.deleteMany({});
      await teacher(sara, 'سارة');
      const res: any = await asSchool(() => service.getMyStats(asTeacher(sara), {}, LATER));
      expect(res.data).toMatchObject({ dateFrom: '2026-10-28', dateTo: '2026-11-26', term: null });
    });

    it('refuses a span over 366 days with an Arabic 400', async () => {
      await teacher(sara, 'سارة');
      await expect(
        asSchool(() =>
          service.getMyStats(asTeacher(sara), { dateFrom: '2025-01-01', dateTo: '2026-01-02' }, LATER),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        asSchool(() =>
          service.getMyStats(asTeacher(sara), { dateFrom: '2025-01-01', dateTo: '2026-01-02' }, LATER),
        ),
      ).rejects.toThrow('366');
    });
  });

  // ─────────────────────────────────────────── 9. today

  describe('9. today', () => {
    const lina = new Types.ObjectId();
    const maha = new Types.ObjectId();
    const reem = new Types.ObjectId();

    beforeEach(async () => {
      // Sunday 4 October. Expected: Noura, Sara, Haya, Lina, Maha. Reem works
      // Mondays only and came in anyway.
      await teacher(noura, 'نورة');
      await teacher(sara, 'سارة');
      await teacher(haya, 'هيا', { workDays: ['sunday', 'monday', 'tuesday'] });
      await teacher(lina, 'لينا');
      await teacher(maha, 'مها');
      await teacher(reem, 'ريم', { workDays: ['monday'] });
      await present(noura, '2026-10-04', 15);
      await present(sara, '2026-10-04', 0);
      await present(reem, '2026-10-04', 0);
      await excuse(haya, '2026-10-04');
    });

    const today = (now: Date, date?: string) =>
      asSchool(() => service.getTodaySnapshot(date, owner, now));

    it('before the day ends: not checked in, nobody absent', async () => {
      const snap: any = await today(riyadh('2026-10-04', '09:00'));
      expect(snap).toEqual({
        date: '2026-10-04', isWorkingDay: true, dayEnded: false,
        expected: 5, present: 2, onTime: 1, late: 1, latenessNotTracked: 0,
        notCheckedIn: 3, absent: null, absentExcused: null, leftEarly: 0,
        attendanceRate: 40, punctualityRate: 50,
      });
    });

    it('after the day ends: absent, with the accepted excuse counted', async () => {
      const snap: any = await today(riyadh('2026-10-04', '14:30'));
      expect(snap).toMatchObject({ dayEnded: true, notCheckedIn: 0, absent: 3, absentExcused: 1 });
    });

    it('a past date reads as ended', async () => {
      const snap: any = await today(riyadh('2026-10-05', '08:00'), '2026-10-04');
      expect(snap).toMatchObject({ dayEnded: true, absent: 3 });
    });

    it('a holiday is not a working day, every figure null', async () => {
      const snap: any = await today(riyadh('2026-09-22', '10:00'));
      expect(snap).toMatchObject({ date: '2026-09-22', isWorkingDay: false, expected: null, absent: null, attendanceRate: null });
    });

    it('agrees with the summary’s day', async () => {
      const snap: any = await today(riyadh('2026-10-04', '14:30'));
      const res: any = await summary('2026-10-04', '2026-10-04', riyadh('2026-10-04', '14:30'));
      expect(res.overview.daily).toEqual([
        {
          date: '2026-10-04', expected: snap.expected, present: snap.present, late: snap.late,
          absent: snap.absent, absentExcused: snap.absentExcused,
          attendanceRate: snap.attendanceRate, punctualityRate: snap.punctualityRate,
        },
      ]);
    });
  });

  // ─────────────────────────────────────────── 10. daily

  it('10. daily: one entry per working day, pooling back to the overview rate', async () => {
    await seedScenario();
    const res: any = await summary('2026-09-01', '2026-09-30');
    const daily = res.overview.daily;

    expect(daily).toHaveLength(20);
    expect(daily.map((x: any) => x.date)).toEqual(SEPT);
    const expected = daily.reduce((n: number, x: any) => n + x.expected, 0);
    const presentSum = daily.reduce((n: number, x: any) => n + x.present, 0);
    expect(expected).toBe(52);
    expect(presentSum).toBe(47);
    expect(rateOf(presentSum, expected)).toBe(res.overview.attendanceRate);

    // The 17th: Noura away, Haya does not work Thursdays.
    expect(daily.find((x: any) => x.date === '2026-09-17')).toMatchObject({
      expected: 2, present: 1, absent: 1, absentExcused: 0, attendanceRate: 50,
    });
    expect(daily.find((x: any) => x.date === '2026-09-10')).toMatchObject({ absent: 1, absentExcused: 1 });
    // Day-off check-in (Haya, Thursday the 3rd) is not counted.
    expect(daily.find((x: any) => x.date === '2026-09-03')).toMatchObject({ expected: 2, present: 2 });

    const weekdays = res.overview.byWeekday;
    expect(weekdays.map((x: any) => x.weekday)).toEqual(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']);
    expect(weekdays.reduce((n: number, x: any) => n + x.days, 0)).toBe(20);
    expect(weekdays.find((x: any) => x.weekday === 'thursday')).toMatchObject({ days: 4, attendanceRate: 75 });
  });

  it('10b. a 120-day period is still one aggregate', async () => {
    await seedScenario();
    const spy = jest.spyOn(m[TeacherAttendance.name], 'aggregate');
    const findSpy = jest.spyOn(m[TeacherAttendance.name], 'find');
    await summary('2026-09-01', '2026-12-29');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(findSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    findSpy.mockRestore();
  });
});
