import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { AttendanceService } from '../attendance/attendance.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { ClassRecordService } from './class-record.service';
import { gradeFigures, overLimit, studentRow, unexcusedDayCount } from './class-record.util';

describe('class record: pure rules', () => {
  const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];

  it('marks present, absent and excused, and counts the rate over the days she was enrolled', () => {
    const row = studentRow(days, [
      { date: '2026-10-05', excuseStatus: 'accepted' },
      { date: '2026-10-06', excuseStatus: 'pending' },
    ]);
    expect(row.cells).toEqual({ '2026-10-04': 'present', '2026-10-05': 'excused', '2026-10-06': 'absent', '2026-10-07': 'present' });
    expect(row).toMatchObject({ countedDays: 4, absentDays: 2, excusedDays: 1, unexcusedDays: 1, presentDays: 2, attendanceRate: 50 });
  });

  it('a day before she joined is blank, not present', () => {
    const row = studentRow(days, [], '2026-10-06');
    expect(row.cells['2026-10-04']).toBeNull();
    expect(row.cells['2026-10-06']).toBe('present');
    expect(row).toMatchObject({ countedDays: 2, attendanceRate: 100 });
  });

  it('the same day recorded by two classes counts once, and an accepted excuse on either wins', () => {
    const row = studentRow(days, [
      { date: '2026-10-04', excuseStatus: null },
      { date: '2026-10-04', excuseStatus: 'accepted' },
    ]);
    expect(row).toMatchObject({ absentDays: 1, excusedDays: 1, unexcusedDays: 0 });
    expect(unexcusedDayCount([{ date: 'a', excuseStatus: null }, { date: 'a', excuseStatus: 'rejected' }, { date: 'b', excuseStatus: 'accepted' }])).toBe(1);
  });

  it('حد الغياب: reached at the limit, off without one', () => {
    expect(overLimit(3, 3)).toBe(true);
    expect(overLimit(2, 3)).toBe(false);
    expect(overLimit(9, null)).toBe(false);
  });

  it('grade figures: average of totals, pass rate from ratings, blanks left out', () => {
    const g = gradeFigures([
      { totals: { m: 90, a: 40 }, ratings: { m: { key: 'excellent' }, a: { key: 'failed' } } },
      { totals: { m: 80, a: null }, ratings: { m: { key: 'very_good' }, a: null } },
    ]);
    expect(g).toEqual({ averageGrade: 70, passRate: 66.7, gradedEntries: 3 });
  });
});

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-class-record${query}`,
);

describe('class record: from the database', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const otherClass = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const reem = new Types.ObjectId();
  const lama = new Types.ObjectId();
  const owner = { role: 'OWNER', userId: String(ownerId), schoolId: String(schoolId) };
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const day = (n: number) => new Date(Date.UTC(2026, 9, n)); // October 2026
  const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => ({
    day: d, isWorkingDay: !['friday', 'saturday'].includes(d), periodsPerDay: null, startTime: null, endTime: null,
  }));
  let service: ClassRecordService;

  beforeAll(async () => {
    const models = [
      [School.name, SchoolSchema], [AcademicYear.name, AcademicYearSchema], [Term.name, TermSchema],
      [Class.name, ClassSchema], [Student.name, StudentSchema], [Lecture.name, LectureSchema],
      [Attendance.name, AttendanceSchema], [Admin.name, AdminSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(URI), MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema })))],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
    service = new ClassRecordService(m.Attendance, m.Student, m.Class, m.Lecture, m.Term);
  });

  afterAll(async () => { await moduleRef?.close(); });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    await m.School.collection.insertOne({
      _id: schoolId, name: 'س', slug: `s${Math.random()}`, email: 'a@b.c', subscriptionStatus: 'active',
      settings: { workSchedule: WEEK, absenceAlertDays: 2, holidays: [{ name: 'إجازة', startDate: day(8), endDate: day(8) }] },
    });
    await m.AcademicYear.collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    // Term: Sun 4 Oct – Fri 9 Oct, in the past, so the window ends at the term's end.
    await m.Term.collection.insertOne({ _id: termId, academicYearId: yearId, name: 'الأولى', order: 1, startDate: day(4), endDate: day(9), status: 'active', schoolId });
    await m.Class.collection.insertMany([
      { _id: classId, name: 'أولى/أ', isActive: true, schoolId },
      { _id: otherClass, name: 'ثانية/أ', isActive: true, schoolId },
    ]);
    await m.Student.collection.insertMany([
      { _id: reem, name: 'ريم', email: 'r@t.t', classId, isActive: true, schoolId },
      { _id: lama, name: 'لمى', email: 'l@t.t', classId, isActive: true, schoolId, registrationDate: day(6) },
    ]);
    await m.Lecture.collection.insertOne({ teacherId, classId, termId, dayOfWeek: 'sunday', slot: 1, schoolId });
    await m.Admin.collection.insertOne({ _id: ownerId, name: 'المالكة', email: 'o@t.t', role: 'OWNER', schoolId });
    await m.Attendance.collection.insertMany([
      { studentId: reem, classId, date: day(5), name: 'ريم', schoolId },
      { studentId: reem, classId, date: day(6), name: 'ريم', schoolId, excuseStatus: 'accepted' },
    ]);
  });

  it('the grid: school days only (weekend and holiday out), joined-late blanks, totals', async () => {
    const res: any = await asSchool(() => service.attendanceRegister({ classId: String(classId) }, owner));
    // 4–9 Oct: Sun–Thu are 4,5,6,7,8; 8 is a holiday, 9 is Friday.
    expect(res.data.days).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    const r = res.data.students.find((s: any) => s.name === 'ريم');
    expect(r.cells).toEqual({ '2026-10-04': 'present', '2026-10-05': 'absent', '2026-10-06': 'excused', '2026-10-07': 'present' });
    expect(r).toMatchObject({ absentDays: 2, excusedDays: 1, unexcusedDays: 1, attendanceRate: 50, overLimit: false });
    const l = res.data.students.find((s: any) => s.name === 'لمى');
    expect(l.cells['2026-10-04']).toBeNull();
    expect(l).toMatchObject({ countedDays: 2, attendanceRate: 100 });
  });

  it('a teacher reads only a class she teaches', async () => {
    const teacher = { role: 'TEACHER', userId: String(teacherId), schoolId: String(schoolId) };
    await expect(asSchool(() => service.attendanceRegister({ classId: String(classId) }, teacher))).resolves.toBeDefined();
    await expect(asSchool(() => service.attendanceRegister({ classId: String(otherClass) }, teacher))).rejects.toThrow('لا يمكنك');
  });

  it('the summary: class attendance rate and who reached the limit', async () => {
    await m.Attendance.collection.insertOne({ studentId: reem, classId, date: day(7), name: 'ريم', schoolId });
    const res: any = await asSchool(() => service.classSummary(String(classId), owner));
    // Reem 1 of 4 present, Lama 2 of 2: 3 of 6.
    expect(res.data).toMatchObject({ schoolDays: 4, studentCount: 2, attendanceRate: 50, absenceAlertDays: 2, overLimitCount: 1 });
    expect(res.data.overLimit).toEqual([{ studentId: String(reem), name: 'ريم', unexcusedDays: 2, absentDays: 3 }]);
    expect(res.data.gradesAvailable).toBe(false);
  });

  it('recording the absence that reaches the limit alerts the admins and the family, once', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const attendance = new AttendanceService(
      m.Attendance, m.Student, m.Class, m.Lecture, m.Term, m.Admin, notifications as any,
      { forLecture: jest.fn() } as any,
    );
    // Reem has 1 unexcused day. The second reaches the limit of 2.
    await asSchool(() => attendance.create({ studentId: String(reem), classId: String(classId), date: '2026-10-07' } as any));
    const limitCalls = () => notifications.notify.mock.calls.map((c) => c[0]).filter((n) => n.type === 'absence_limit_reached');
    expect(limitCalls().map((n) => String(n.recipientId)).sort()).toEqual([String(ownerId), String(reem)].sort());
    expect(limitCalls()[0].data).toMatchObject({ unexcusedDays: 2, limit: 2, className: 'أولى/أ' });

    // A third day is past the limit: no second alert.
    notifications.notify.mockClear();
    await asSchool(() => attendance.create({ studentId: String(reem), classId: String(classId), date: '2026-10-04' } as any));
    expect(limitCalls()).toHaveLength(0);
    expect(notifications.notify).toHaveBeenCalled(); // the ordinary absence notice still went
  });

  it('no limit set: no alert', async () => {
    await m.School.collection.updateOne({ _id: schoolId }, { $set: { 'settings.absenceAlertDays': null } });
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const attendance = new AttendanceService(
      m.Attendance, m.Student, m.Class, m.Lecture, m.Term, m.Admin, notifications as any, { forLecture: jest.fn() } as any,
    );
    await asSchool(() => attendance.create({ studentId: String(reem), classId: String(classId), date: '2026-10-07' } as any));
    expect(notifications.notify.mock.calls.filter((c) => c[0].type === 'absence_limit_reached')).toHaveLength(0);
  });
});
