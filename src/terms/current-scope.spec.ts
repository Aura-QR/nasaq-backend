import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Term, TermSchema } from './schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { TeacherAssignment, TeacherAssignmentSchema } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { LecturesService } from '../lectures/lectures.service';
import { ClassesService } from '../classes/classes.service';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import { currentScope, pickCurrentTerm } from './current-scope.util';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-current-scope${query}`,
);

/**
 * The yamamah report: a new active year (2028) beside an archived one
 * (2027/2028), every term still «upcoming», one teacher with a lecture in
 * each. Teacher pages showed both, because each service looked for a term
 * with status 'active', found none, and applied no filter.
 */
describe('teacher views are scoped to the active academic year', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const ids: Record<string, Types.ObjectId> = {};
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));

  beforeAll(async () => {
    const models = [
      [AcademicYear.name, AcademicYearSchema], [Term.name, TermSchema], [Class.name, ClassSchema],
      [Lecture.name, LectureSchema], [SubjectOffering.name, SubjectOfferingSchema], [Subject.name, SubjectSchema],
      [Teacher.name, TeacherSchema], [GradeLevel.name, GradeLevelSchema],
      [TeacherAssignment.name, TeacherAssignmentSchema], [Exam.name, ExamSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    for (const [key, status] of [['old', 'archived'], ['new', 'active']] as const) {
      ids[`${key}Year`] = (await m.AcademicYear.collection.insertOne({ name: key, status, schoolId })).insertedId;
      // Same name in both years, on purpose: never match a term by name.
      ids[`${key}Term`] = (await m.Term.collection.insertOne({ name: 'ترم اول', status: 'upcoming', order: 1,
        academicYearId: ids[`${key}Year`], startDate: day(1), endDate: day(28), schoolId })).insertedId;
      ids[`${key}Class`] = (await m.Class.collection.insertOne({ name: key === 'new' ? 'G9' : 'م1/أ',
        academicYearId: ids[`${key}Year`], gradeLevelId: new Types.ObjectId(), gender: 'female', maxCapacity: 30,
        isActive: true, schoolId })).insertedId;
      ids[`${key}Offering`] = (await m.SubjectOffering.collection.insertOne({ subjectId: new Types.ObjectId(),
        gradeLevelId: new Types.ObjectId(), termId: ids[`${key}Term`], schoolId })).insertedId;
      ids[`${key}Lecture`] = (await m.Lecture.collection.insertOne({ teacherId, classId: ids[`${key}Class`],
        subjectOfferingId: ids[`${key}Offering`], termId: ids[`${key}Term`], dayOfWeek: 'sunday', slot: key === 'new' ? 2 : 5,
        schoolId })).insertedId;
      await m.TeacherAssignment.collection.insertOne({ teacherId, subjectOfferingId: ids[`${key}Offering`],
        classId: null, schoolId });
    }
  });

  const lectures = () => new LecturesService(m.Lecture, m.Class, m.Teacher, {} as any, m.SubjectOffering,
    m.TeacherAssignment, m.Term, {} as any);
  const lectureIds = (rows: any[]) => rows.map((r: any) => String(r._id));

  it('resolves the active year and its term, though every term is «upcoming»', async () => {
    const scope = await asSchool(() => currentScope(conn));
    expect(String(scope.yearId)).toBe(String(ids.newYear));
    expect(String(scope.termId)).toBe(String(ids.newTerm));
    expect(scope.termIds!.map(String)).toEqual([String(ids.newTerm)]);
  });

  it('GET /lectures?teacherId= returns this year only (A1)', async () => {
    const rows = await asSchool(() => lectures().findAll(undefined, undefined, String(teacherId)));
    expect(lectureIds(rows)).toEqual([String(ids.newLecture)]);
    // The year rides on the term for the client to check.
    expect(String((rows[0] as any).termId.academicYearId)).toBe(String(ids.newYear));
  });

  it('a named year or term still reaches history (A2, A7)', async () => {
    const byYear = await asSchool(() =>
      lectures().findAll(undefined, undefined, String(teacherId), undefined, undefined, String(ids.oldYear)));
    expect(lectureIds(byYear)).toEqual([String(ids.oldLecture)]);
    const byTerm = await asSchool(() => lectures().findAll(String(ids.oldTerm), undefined, String(teacherId)));
    expect(lectureIds(byTerm)).toEqual([String(ids.oldLecture)]);
  });

  it('the teacher timetable and class list are this year only (A3)', async () => {
    const mine = await asSchool(() => lectures().findMyTeacherLectures(String(teacherId)));
    expect(lectureIds(mine)).toEqual([String(ids.newLecture)]);
    const classes: any = await asSchool(() =>
      new ClassesService(m.Class, m.Teacher, m.Lecture, m.Term).findMyTeacherClasses(String(teacherId)));
    expect(classes.data.map((c: any) => c.name)).toEqual(['G9']);
  });

  it('the assignments behind the exam form are this year only', async () => {
    const rows: any[] = await asSchool(() =>
      new TeacherAssignmentsService(m.TeacherAssignment, m.Teacher, m.Subject, m.GradeLevel, m.SubjectOffering)
        .findAll({ teacherId: String(teacherId) }));
    expect(rows.map((r: any) => String(r.subjectOfferingId?._id ?? r.subjectOfferingId))).toEqual([String(ids.newOffering)]);
  });

  it('a new year with no lectures is empty, not last year (A9)', async () => {
    await m.Lecture.collection.deleteOne({ _id: ids.newLecture });
    const mine = await asSchool(() => lectures().findMyTeacherLectures(String(teacherId)));
    expect(mine).toEqual([]);
  });

  it('a year with no terms yet shows nothing, not every year', async () => {
    await m.Term.collection.deleteOne({ _id: ids.newTerm });
    const rows = await asSchool(() => lectures().findAll(undefined, undefined, String(teacherId)));
    expect(rows).toEqual([]);
  });

  it('picks the current term: active, then today\'s, then the latest started, then the next', () => {
    const now = new Date(Date.UTC(2026, 9, 10));
    const t = (id: string, status: string, start: number, end: number) => ({
      _id: id, status, startDate: new Date(Date.UTC(2026, start, 1)), endDate: new Date(Date.UTC(2026, end, 1)),
    });
    expect(pickCurrentTerm([t('a', 'upcoming', 8, 11), t('b', 'active', 11, 12)], now)._id).toBe('b');
    expect(pickCurrentTerm([t('a', 'upcoming', 8, 11), t('b', 'upcoming', 11, 12)], now)._id).toBe('a');
    expect(pickCurrentTerm([t('a', 'closed', 1, 3), t('b', 'closed', 4, 6)], now)._id).toBe('b');
    expect(pickCurrentTerm([t('a', 'upcoming', 11, 12), t('b', 'upcoming', 10, 11)], now)._id).toBe('b');
    expect(pickCurrentTerm([], now)).toBeNull();
  });

  it('refuses to record tracking on last year\'s period (A5)', async () => {
    const { DailyTrackingService } = await import('../daily-tracking/daily-tracking.service');
    const tracking = new DailyTrackingService(
      {} as any, m.Lecture, { find: () => ({ select: () => ({ exec: async () => [] }) }) } as any,
      {} as any, {} as any,
    );
    await expect(asSchool(() =>
      tracking.bulkUpsert(
        { lectureId: String(ids.oldLecture), date: '2026-09-06', records: [{ studentId: String(new Types.ObjectId()), absent: false }] } as any,
        { role: 'OWNER', userId: String(new Types.ObjectId()) },
      ),
    )).rejects.toBeInstanceOf(ConflictException);
  });
});
