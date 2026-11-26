import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { DutyService } from './duty.service';
import { LeaveRequest, LeaveRequestSchema } from './schemas/leave-request.schema';
import { DutySupervisor, DutySupervisorSchema } from './schemas/duty-supervisor.schema';
import { Substitution, SubstitutionSchema } from './schemas/substitution.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { StaffAttendance, StaffAttendanceSchema } from '../staff-attendance/schemas/staff-attendance.schema';
import { StaffLeaveRequest, StaffLeaveRequestSchema } from '../staff-attendance/schemas/staff-leave-request.schema';
import { TeacherAttendance, TeacherAttendanceSchema } from '../teacher-attendance/schemas/teacher-attendance.schema';
import { TeacherAbsenceExcuse, TeacherAbsenceExcuseSchema } from '../teacher-attendance/schemas/teacher-absence-excuse.schema';
import { TeacherAbsenceNotice, TeacherAbsenceNoticeSchema } from '../teacher-attendance/schemas/teacher-absence-notice.schema';
import { TeacherAttendanceService } from '../teacher-attendance/teacher-attendance.service';
import { TeacherAbsenceExcuseService } from '../teacher-attendance/teacher-absence-excuse.service';
import { TeacherAbsenceSweepService } from '../teacher-attendance/teacher-absence-sweep.service';
import { schoolNow } from '../teacher-attendance/teacher-presence.util';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-planned-absence${query}`,
);

/** Days counted from today in Riyadh, so "today or later" holds whenever this runs. */
const TODAY = schoolNow('Asia/Riyadh').label;
const addDays = (label: string, n: number) =>
  new Date(Date.parse(`${label}T00:00:00.000Z`) + n * 86400_000).toISOString().slice(0, 10);
const nextWeekday = (dow: number, after = TODAY) => {
  for (let i = 1; i <= 7; i++) {
    const label = addDays(after, i);
    if (new Date(`${label}T00:00:00.000Z`).getUTCDay() === dow) return label;
  }
  throw new Error('unreachable');
};
const d = (label: string) => new Date(`${label}T00:00:00.000Z`);
const riyadh = (label: string, time: string) => new Date(`${label}T${time}:00.000+03:00`);

/** The Thursday Ms. Haya is away, and the Sunday a three-day leave starts. */
const THU = nextWeekday(4);
const SUN = nextWeekday(0);

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => {
  const working = !['friday', 'saturday'].includes(day);
  return { day, isWorkingDay: working, startTime: working ? '07:00' : null, endTime: working ? '13:00' : null };
});

/**
 * «غياب مسبق»: on Wednesday Ms. Haya says she has a hospital appointment on
 * Thursday. The director records it, arranges Thursday's cover that same
 * day, and on Thursday Haya is absent — excused, not asked why.
 */
describe('planned absence', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const haya = new Types.ObjectId();
  const noura = new Types.ObjectId();
  const sara = new Types.ObjectId();
  const arwa = new Types.ObjectId(); // files her own sick leave
  const lectures: Types.ObjectId[] = [];

  const owner = { role: 'OWNER', userId: String(ownerId), schoolId: String(schoolId), name: 'المديرة' };
  const asTeacher = (id: Types.ObjectId) => ({ role: 'TEACHER', userId: String(id), schoolId: String(schoolId) });
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  let notify: jest.Mock;
  let duty: DutyService;
  let attendance: TeacherAttendanceService;
  let excuses: TeacherAbsenceExcuseService;
  let sweep: TeacherAbsenceSweepService;

  const settings = (over: any = {}) => ({
    teacherCheckInEnabled: true,
    timezone: 'Asia/Riyadh',
    location: { lat: 24.7136, lng: 46.6753 },
    checkInRadiusMeters: 150,
    schoolNetworkIps: [],
    workSchedule: WEEK,
    holidays: [],
    teacherAbsenceAlertDays: 1,
    ...over,
  });

  beforeAll(async () => {
    const models = [
      [LeaveRequest.name, LeaveRequestSchema], [DutySupervisor.name, DutySupervisorSchema],
      [Substitution.name, SubstitutionSchema], [School.name, SchoolSchema], [AcademicYear.name, AcademicYearSchema],
      [Teacher.name, TeacherSchema], [Lecture.name, LectureSchema], [Term.name, TermSchema], [Class.name, ClassSchema],
      [Subject.name, SubjectSchema], [SubjectOffering.name, SubjectOfferingSchema], [Admin.name, AdminSchema],
      [StaffAttendance.name, StaffAttendanceSchema], [StaffLeaveRequest.name, StaffLeaveRequestSchema],
      [TeacherAttendance.name, TeacherAttendanceSchema], [TeacherAbsenceExcuse.name, TeacherAbsenceExcuseSchema],
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
    await m[LeaveRequest.name].init();
    await m[TeacherAbsenceNotice.name].init();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    lectures.length = 0;
    notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as any;
    duty = new DutyService(
      m[LeaveRequest.name], m[DutySupervisor.name], m[Substitution.name], m[Teacher.name], m[Lecture.name],
      m[TeacherAttendance.name], m[Term.name], m[Class.name], m[Admin.name], m[StaffAttendance.name],
      m[StaffLeaveRequest.name], notifications,
    );
    excuses = new TeacherAbsenceExcuseService(
      m[TeacherAbsenceExcuse.name], m[TeacherAttendance.name], m[Teacher.name], m[School.name], m[Admin.name],
      notifications, undefined, m[LeaveRequest.name],
    );
    attendance = new TeacherAttendanceService(
      m[TeacherAttendance.name], m[Teacher.name], m[School.name], m[LeaveRequest.name], m[Admin.name],
      notifications, excuses,
    );
    sweep = new TeacherAbsenceSweepService(
      m[School.name], m[Teacher.name], m[TeacherAttendance.name], m[TeacherAbsenceExcuse.name],
      m[TeacherAbsenceNotice.name], notifications, attendance, m[LeaveRequest.name],
    );

    await m[School.name].collection.insertOne({
      _id: schoolId, name: 'مدرسة', slug: `s${Math.random()}`, email: 'a@b.c', subscriptionStatus: 'active',
      isActive: true, settings: settings(),
    });
    await m[AcademicYear.name].collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    await m[Term.name].collection.insertOne({
      _id: termId, academicYearId: yearId, name: 'الترم الأول', order: 1,
      startDate: d(addDays(TODAY, -60)), endDate: d(addDays(TODAY, 90)), status: 'active', schoolId,
    });
    await m[Admin.name].collection.insertOne({ _id: ownerId, name: 'المديرة', role: 'OWNER', schoolId, email: 'o@s.sa', username: 'owner' });
    for (const [_id, name, over] of [
      [haya, 'هيا', {}], [noura, 'نورة', {}], [sara, 'سارة', {}], [arwa, 'أروى', {}],
    ] as const) {
      await m[Teacher.name].collection.insertOne({ _id, name, email: `${String(_id)}@t.sa`, isActive: true, workDays: [], schoolId, ...over });
    }
    const subjectId = (await m[Subject.name].collection.insertOne({ subjectName: 'العلوم', schoolId })).insertedId;
    const offering = (await m[SubjectOffering.name].collection.insertOne({ subjectId, gradeLevelId: gradeId, termId, schoolId })).insertedId;
    const classId = (await m[Class.name].collection.insertOne({
      name: 'أولى/أ', gradeLevelId: gradeId, academicYearId: yearId, gender: 'female', maxCapacity: 30, isActive: true, schoolId,
    })).insertedId;
    // Haya teaches periods 1–4 on Thursday; Noura has period 1, Sara period 3.
    for (const slot of [1, 2, 3, 4]) {
      lectures.push((await m[Lecture.name].collection.insertOne({
        classId, subjectOfferingId: offering, termId, teacherId: haya, dayOfWeek: 'thursday', slot, schoolId,
      })).insertedId);
    }
    const otherClass = async (name: string) => (await m[Class.name].collection.insertOne({
      name, gradeLevelId: gradeId, academicYearId: yearId, gender: 'female', maxCapacity: 30, isActive: true, schoolId,
    })).insertedId;
    await m[Lecture.name].collection.insertMany([
      { classId: await otherClass('أولى/ب'), subjectOfferingId: offering, termId, teacherId: noura, dayOfWeek: 'thursday', slot: 1, schoolId },
      { classId: await otherClass('أولى/ج'), subjectOfferingId: offering, termId, teacherId: sara, dayOfWeek: 'thursday', slot: 3, schoolId },
    ]);
    // Everyone has used check-in before.
    for (const id of [haya, noura, sara, arwa]) {
      await m[TeacherAttendance.name].collection.insertOne({
        teacherId: id, date: d(addDays(THU, -7)), checkInAt: riyadh(addDays(THU, -7), '06:50'), method: 'location',
        isWorkingDay: true, lateMinutes: 0, schoolId,
      });
    }
  });

  const plan = (over: any = {}, user: any = owner) =>
    asSchool(() =>
      duty.createLeaveRequest({ kind: 'full_day', date: THU, reason: 'موعد طبي', teacherId: String(haya), ...over } as any, user),
    );
  const board = (date = THU, user: any = owner) => asSchool(() => duty.getCoverage(date, user));
  const cover = (slot: number, who: Types.ObjectId) =>
    asSchool(() =>
      duty.createSubstitution({ date: THU, lectureId: String(lectures[slot - 1]), substituteTeacherId: String(who), reason: 'planned_absence' } as any, owner),
    );
  const checkIn = (id: Types.ObjectId, label = THU) =>
    m[TeacherAttendance.name].collection.insertOne({
      teacherId: id, date: d(label), checkInAt: riyadh(label, '07:40'), method: 'location', isWorkingDay: true, lateMinutes: 40, schoolId,
    });

  // ─────────────────────────────────────────── 1. the scenario

  it('1. filed by staff → approved; Thursday\'s board, covers, an excused absence, no sweep notice', async () => {
    const filed: any = await plan();
    expect(filed.data).toHaveLength(1);
    expect(filed.data[0]).toMatchObject({ kind: 'full_day', status: 'approved', leaveAt: null, fromSlot: null, reviewedByName: 'المديرة', groupDays: 1 });
    expect(filed.data[0].groupId).toBeTruthy();
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ recipientId: haya, type: 'leave_approved', title: 'تم تسجيل غيابك المسبق', body: `${THU} · موعد طبي` }),
    ]);

    // The board lists her four lectures the day before.
    const before: any = await board();
    expect(before).toMatchObject({ isWorkingDay: true, isFuture: true, checkInInUse: false });
    expect(before.uncovered.map((e: any) => [e.slot, e.reason])).toEqual([
      [1, 'planned_absence'], [2, 'planned_absence'], [3, 'planned_absence'], [4, 'planned_absence'],
    ]);
    expect(before.plannedAbsences).toEqual([
      expect.objectContaining({ teacherId: String(haya), name: 'هيا', reason: 'موعد طبي', groupId: filed.groupId }),
    ]);
    expect(before.onLeave).toEqual([]);
    const slot2 = before.uncovered.find((e: any) => e.slot === 2).suggestions.map((s: any) => s.name);
    expect(slot2).toEqual(expect.arrayContaining(['نورة', 'سارة']));
    expect(slot2).not.toContain('هيا');

    // Covers set the day before; the notice names the weekday.
    notify.mockClear();
    await cover(2, noura);
    await cover(4, sara);
    expect(notify.mock.calls[0][0]).toMatchObject({ recipientId: String(noura), type: 'cover_assigned' });
    expect(notify.mock.calls[0][0].body.startsWith(`الخميس ${THU} · الحصة 2`)).toBe(true);
    expect(notify.mock.calls[0][0].body).toContain('بدلًا من هيا');

    // Thursday, before anyone checks in: both covered lectures are there.
    const morning: any = await board();
    expect(morning.covered.map((e: any) => [e.slot, e.substituteTeacherName, e.ownerPresent])).toEqual([
      [2, 'نورة', false], [4, 'سارة', false],
    ]);
    expect(morning.uncovered.map((e: any) => e.slot)).toEqual([1, 3]);

    // Thursday: everyone else comes in; Haya does not.
    await checkIn(noura);
    await checkIn(sara);
    await checkIn(arwa);
    const afterSchool = riyadh(THU, '15:00');

    const summary: any = await asSchool(() =>
      attendance.getMonthlySummary({ dateFrom: THU, dateTo: THU } as any, owner, { now: afterSchool }),
    );
    const row = summary.data.find((r: any) => String(r.teacherId) === String(haya));
    expect(row).toMatchObject({
      daysAbsent: 1, daysAbsentExcused: 1, daysAbsentUnexcused: 0, attendanceRate: 0, overLimit: false,
      absentDates: [{ date: THU, excused: true }],
    });
    expect(summary.overview).toMatchObject({ totalAbsentExcused: 1, totalAbsentUnexcused: 0, overLimitCount: 0 });
    expect(summary.overview.daily[0]).toMatchObject({ absent: 1, absentExcused: 1 });

    const today: any = await asSchool(() => attendance.getTodaySnapshot(THU, owner, afterSchool));
    expect(today).toMatchObject({ absent: 1, absentExcused: 1 });

    const mine: any = await asSchool(() =>
      attendance.getMyStats(asTeacher(haya), { dateFrom: THU, dateTo: THU }, afterSchool),
    );
    expect(mine.data).toMatchObject({ daysAbsentExcused: 1, daysAbsentUnexcused: 0, overLimit: false });

    // Not asked why, and not counted toward the absence limit (1).
    notify.mockClear();
    const school = await m[School.name].collection.findOne({ _id: schoolId });
    expect(await sweep.sweepSchool(school, riyadh(THU, '13:45'))).toBe(0);
    expect(await asSchool(() => attendance.alertTeacherAbsenceLimit({ _id: haya, name: 'هيا' }, d(THU), schoolId, afterSchool))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    const pending: any = await asSchool(() => excuses.pendingDays(asTeacher(haya), 14, afterSchool));
    expect(pending.data.map((p: any) => p.date)).not.toContain(THU);
  });

  // ─────────────────────────────────────────── 2. variant 5

  it('2. she comes in after all: covered entries say ownerPresent, and she is present', async () => {
    await plan();
    await cover(2, noura);
    await cover(4, sara);
    for (const id of [haya, noura, sara, arwa]) await checkIn(id);

    const b: any = await board();
    expect(b.covered.map((e: any) => [e.slot, e.ownerPresent])).toEqual([[2, true], [4, true]]);
    // Her other periods no longer need anyone: she is here.
    expect(b.uncovered).toEqual([]);
    expect(b.plannedAbsences[0].present).toBe(true);

    const summary: any = await asSchool(() =>
      attendance.getMonthlySummary({ dateFrom: THU, dateTo: THU, teacherId: String(haya) } as any, owner, { now: riyadh(THU, '15:00') }),
    );
    expect(summary.data[0]).toMatchObject({ daysAbsent: 0, daysAbsentExcused: 0 });

    // Cancelling a cover tells the substitute, as before.
    notify.mockClear();
    await asSchool(() => duty.removeSubstitution(String(b.covered[0].substitutionId)));
    expect(notify.mock.calls[0][0]).toMatchObject({ recipientId: noura, type: 'cover_removed' });
  });

  // ─────────────────────────────────────────── 3. variant 6

  it('3. a teacher\'s own Sun–Tue: three pending rows, one notice; one review approves all; cancelling', async () => {
    const tue = addDays(SUN, 2);
    const filed: any = await plan({ date: SUN, dateTo: tue, teacherId: undefined, reason: 'إجازة مرضية' }, asTeacher(arwa));
    expect(filed.data.map((r: any) => [r.date, r.status])).toEqual([
      [SUN, 'pending'], [addDays(SUN, 1), 'pending'], [tue, 'pending'],
    ]);
    expect(new Set(filed.data.map((r: any) => String(r.groupId))).size).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      recipientId: String(ownerId), type: 'leave_requested', title: 'طلب غياب يوم كامل',
      body: `أروى · ${SUN} إلى ${tue} — إجازة مرضية`,
    });

    const listed: any = await asSchool(() => duty.listLeaveRequests({ kind: 'full_day' }, owner));
    expect(listed.map((r: any) => r.groupDays)).toEqual([3, 3, 3]);
    expect(await asSchool(() => duty.listLeaveRequests({ kind: 'early_leave' }, owner))).toEqual([]);

    // Approving one approves the three, with one notice.
    notify.mockClear();
    const reviewed: any = await asSchool(() => duty.reviewLeaveRequest(String(filed.data[1]._id), { status: 'approved' } as any, owner));
    expect(reviewed.data.map((r: any) => r.status)).toEqual(['approved', 'approved', 'approved']);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'leave_approved', title: 'تمت الموافقة على غيابك', body: `${SUN} إلى ${tue}` });

    // Staff drop one day of three.
    const day: any = await asSchool(() => duty.cancelLeaveRequest(String(filed.data[0]._id), owner, 'day'));
    expect(day.cancelled).toEqual([{ _id: String(filed.data[0]._id), date: SUN }]);
    expect(await m[LeaveRequest.name].collection.countDocuments({ groupId: filed.data[0].groupId })).toBe(2);
  });

  it('3b. the teacher cancels her pending group: all of it goes', async () => {
    const filed: any = await plan({ date: SUN, dateTo: addDays(SUN, 2), teacherId: undefined }, asTeacher(arwa));
    await asSchool(() => duty.cancelLeaveRequest(String(filed.data[2]._id), asTeacher(arwa)));
    expect(await m[LeaveRequest.name].collection.countDocuments({})).toBe(0);
  });

  // ─────────────────────────────────────────── 4. ranges

  describe('4. ranges', () => {
    it('skips weekends, holidays and her own days off', async () => {
      // Thursday → the next Tuesday; Monday is a holiday; she works Sun/Tue/Thu… but not Thu here.
      const mon = addDays(THU, 4);
      await m[School.name].collection.updateOne({ _id: schoolId }, {
        $set: { 'settings.holidays': [{ name: 'إجازة', startDate: d(mon), endDate: d(mon) }] },
      });
      await m[Teacher.name].collection.updateOne({ _id: arwa }, { $set: { workDays: ['sunday', 'monday', 'tuesday'] } });
      const filed: any = await plan({ date: THU, dateTo: addDays(THU, 5), teacherId: String(arwa) });
      expect(filed.data.map((r: any) => r.date)).toEqual([addDays(THU, 3), addDays(THU, 5)]);
    });

    it('refuses an all-weekend range, over 30 days, a past date, or a reviewed day inside — writing nothing', async () => {
      const fri = addDays(THU, 1);
      await expect(plan({ date: fri, dateTo: addDays(fri, 1) })).rejects.toThrow('لا توجد أيام دوام في الفترة المحددة');
      await expect(plan({ date: THU, dateTo: addDays(THU, 30) })).rejects.toThrow('30');
      await expect(plan({ date: addDays(TODAY, -1) })).rejects.toBeInstanceOf(BadRequestException);

      // An early leave already approved on the Sunday after.
      const sun = addDays(THU, 3);
      await m[LeaveRequest.name].collection.insertOne({
        teacherId: haya, teacherName: 'هيا', date: d(sun), leaveAt: '11:00', status: 'approved', reason: 'ظرف', schoolId,
      });
      await expect(plan({ date: THU, dateTo: addDays(THU, 5) })).rejects.toThrow(`يوجد طلب مراجَع بتاريخ ${sun}`);
      expect(await m[LeaveRequest.name].collection.countDocuments({})).toBe(1);
    });

    it('a pending request on a day becomes this one', async () => {
      await asSchool(() => duty.createLeaveRequest({ date: THU, leaveAt: '11:00', reason: 'ظرف' } as any, asTeacher(haya)));
      const filed: any = await plan();
      expect(filed.data).toHaveLength(1);
      expect(filed.data[0]).toMatchObject({ kind: 'full_day', leaveAt: null, status: 'approved' });
      expect(await m[LeaveRequest.name].collection.countDocuments({})).toBe(1);
    });
  });

  // ─────────────────────────────────────────── 5. early leave unaffected

  describe('5. early leave is unaffected', () => {
    // Every day a working day, so "today" works whatever day this runs on.
    const allWeek = WEEK.map((w) => ({ ...w, isWorkingDay: true, startTime: '07:00', endTime: '23:59' }));
    const onSite = { lat: 24.7136, lng: 46.6753 };
    const req = { ip: '203.0.113.5', headers: {} };

    beforeEach(async () => {
      await m[School.name].collection.updateOne({ _id: schoolId }, { $set: { 'settings.workSchedule': allWeek } });
      // Today may be the day of the earlier fixture check-in; start clean.
      await m[TeacherAttendance.name].collection.deleteMany({ teacherId: noura });
      await m[TeacherAttendance.name].collection.insertOne({
        teacherId: noura, date: d(new Date().toISOString().slice(0, 10)), checkInAt: new Date(Date.now() - 3 * 3600_000),
        method: 'location', isWorkingDay: true, lateMinutes: 0, schoolId,
      });
    });
    const todayUtc = () => d(new Date().toISOString().slice(0, 10));

    it('a full_day row is not an early leave at check-out, and offers no «تسجيل العودة»', async () => {
      await m[LeaveRequest.name].collection.insertOne({
        teacherId: noura, date: todayUtc(), kind: 'full_day', leaveAt: null, fromSlot: null, status: 'approved', schoolId,
      });
      await expect(asSchool(() => attendance.returnFromLeave(asTeacher(noura), onSite as any, req)))
        .rejects.toThrow('لا يوجد استئذان معتمد');
      await asSchool(() => attendance.checkOut(asTeacher(noura), onSite as any, req));
      const rec: any = await m[TeacherAttendance.name].collection.findOne({ teacherId: noura, date: todayUtc() });
      expect(rec.earlyLeaveApproved).toBe(false);
    });

    it('an old early leave (no kind) still counts at check-out and offers the return', async () => {
      await m[LeaveRequest.name].collection.insertOne({
        teacherId: noura, date: todayUtc(), leaveAt: '10:00', fromSlot: null, status: 'approved', schoolId,
      });
      await asSchool(() => attendance.checkOut(asTeacher(noura), onSite as any, req));
      const rec: any = await m[TeacherAttendance.name].collection.findOne({ teacherId: noura, date: todayUtc() });
      expect(rec).toMatchObject({ earlyLeaveApproved: true, approvedLeaveAt: '10:00' });
      const back: any = await asSchool(() => attendance.returnFromLeave(asTeacher(noura), onSite as any, req));
      expect(back.message).toBe('تم تسجيل عودتك من الاستئذان');
      expect(await asSchool(() => duty.findApprovedLeave(noura, todayUtc()))).toMatchObject({ leaveAt: '10:00' });
      expect(await asSchool(() => duty.findApprovedLeave(noura, todayUtc(), 'full_day'))).toBeNull();
    });
  });

  // ─────────────────────────────────────────── 6. rejecting with covers

  it('6. rejecting an approved group with covers returns them and keeps them', async () => {
    const filed: any = await plan();
    await cover(2, noura);
    const res: any = await asSchool(() => duty.reviewLeaveRequest(String(filed.data[0]._id), { status: 'rejected' } as any, owner));
    expect(res.affectedCovers).toEqual([
      expect.objectContaining({ date: THU, slot: 2, substituteTeacherName: 'نورة' }),
    ]);
    expect(await m[Substitution.name].collection.countDocuments({})).toBe(1);
    // Rejected: no longer on the board as a planned absence; the cover still shows.
    const b: any = await board();
    expect(b.plannedAbsences).toEqual([]);
    expect(b.covered.map((e: any) => e.slot)).toEqual([2]);
  });

  // ─────────────────────────────────────────── 7. holiday

  it('7. a holiday on the board: not a working day, empty lists', async () => {
    await m[School.name].collection.updateOne({ _id: schoolId }, {
      $set: { 'settings.holidays': [{ name: 'اليوم الوطني', startDate: d(THU), endDate: d(THU) }] },
    });
    const b: any = await board();
    expect(b).toMatchObject({ isWorkingDay: false, uncovered: [], covered: [], plannedAbsences: [] });
    expect(b.message).toContain('اليوم الوطني');
  });
});
