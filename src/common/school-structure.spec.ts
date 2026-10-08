import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { TeacherAssignment, TeacherAssignmentSchema } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { DailyTracking, DailyTrackingSchema } from '../daily-tracking/schemas/daily-tracking.schema';
import { Preparation, PreparationSchema } from '../preparation/schemas/preparation.schema';
import { TeacherConstraint, TeacherConstraintSchema } from '../teacher-constraints/schemas/teacher-constraint.schema';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { TermsService } from '../terms/terms.service';
import { ClassesService } from '../classes/classes.service';
import { SubjectOfferingsService } from '../subject-offerings/subject-offerings.service';
import { cleanupLeftovers } from './school-structure.util';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-school-structure${query}`,
);

/**
 * Deleting a year, term, class or subject offering takes its timetable,
 * teacher assignments and distributions with it, and is refused while marks,
 * attendance, plans or students hang off it. Reported from a test school: a
 * deleted year left its offerings, timetable and assignments behind, the
 * exam form still listed last year's subject, and a final set on it went to
 * last year's classes.
 */
describe('school structure — deletes cascade the skeleton and refuse over work', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const asSchool = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  beforeAll(async () => {
    const models = [
      [AcademicYear.name, AcademicYearSchema], [Term.name, TermSchema], [Class.name, ClassSchema],
      [SubjectOffering.name, SubjectOfferingSchema], [Lecture.name, LectureSchema],
      [TeacherAssignment.name, TeacherAssignmentSchema], [GradesCriteria.name, GradesCriteriaSchema],
      [Exam.name, ExamSchema], [Enrollment.name, EnrollmentSchema], [Attendance.name, AttendanceSchema],
      [DailyTracking.name, DailyTrackingSchema], [Preparation.name, PreparationSchema],
      [TeacherConstraint.name, TeacherConstraintSchema],
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

  /** A year with one term, one class, one offering, a period, an assignment, a distribution. */
  const year = async (status = 'archived') => {
    const yearId = (await m.AcademicYear.collection.insertOne({ name: `y${Math.random()}`, status, schoolId })).insertedId;
    const termId = (await m.Term.collection.insertOne({ academicYearId: yearId, name: 't', order: 1, schoolId,
      startDate: new Date(), endDate: new Date(), status: 'active' })).insertedId;
    const classId = (await m.Class.collection.insertOne({ name: 'م1/أ', academicYearId: yearId,
      gradeLevelId: new Types.ObjectId(), gender: 'female', maxCapacity: 30, isActive: true, schoolId })).insertedId;
    const offeringId = (await m.SubjectOffering.collection.insertOne({ termId, subjectId: new Types.ObjectId(),
      gradeLevelId: new Types.ObjectId(), schoolId })).insertedId;
    const lectureId = (await m.Lecture.collection.insertOne({ classId, subjectOfferingId: offeringId, termId,
      teacherId: new Types.ObjectId(), dayOfWeek: 'sunday', slot: 1, schoolId })).insertedId;
    await m.TeacherAssignment.collection.insertOne({ teacherId: new Types.ObjectId(), subjectOfferingId: offeringId,
      classId: null, schoolId });
    await m.GradesCriteria.collection.insertOne({ subjectOfferingId: offeringId, schoolId });
    await m.TeacherConstraint.collection.insertOne({ teacherId: new Types.ObjectId(), termId, schoolId });
    return { yearId, termId, classId, offeringId, lectureId };
  };
  const left = async () => ({
    terms: await m.Term.collection.countDocuments({}),
    classes: await m.Class.collection.countDocuments({}),
    offerings: await m.SubjectOffering.collection.countDocuments({}),
    lectures: await m.Lecture.collection.countDocuments({}),
    assignments: await m.TeacherAssignment.collection.countDocuments({}),
    criteria: await m.GradesCriteria.collection.countDocuments({}),
    constraints: await m.TeacherConstraint.collection.countDocuments({}),
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
  });

  const years = () => new AcademicYearsService(m.AcademicYear, m.Enrollment, m.Class, m.Term, m.Lecture);

  it('a year takes its offerings, timetable, assignments and distributions with it', async () => {
    const old = await year();
    await year('active');

    await asSchool(() => years().remove(String(old.yearId)));

    expect(await left()).toEqual({
      terms: 1, classes: 1, offerings: 1, lectures: 1, assignments: 1, criteria: 1, constraints: 1,
    });
  });

  it('a year with an exam on its subject is refused, and nothing goes', async () => {
    const old = await year();
    await year('active');
    await m.Exam.collection.insertOne({ subjectOfferingId: old.offeringId, classIds: [old.classId], schoolId });

    await expect(asSchool(() => years().remove(String(old.yearId)))).rejects.toBeInstanceOf(ConflictException);
    expect((await left()).offerings).toBe(2);
  });

  it('a term with tracking on its subject is refused; an empty one takes its offerings', async () => {
    const a = await year('active');
    await m.DailyTracking.collection.insertOne({ subjectOfferingId: a.offeringId, classId: a.classId, schoolId });
    const terms = new TermsService(m.Term);

    await expect(asSchool(() => terms.remove(String(a.termId)))).rejects.toBeInstanceOf(ConflictException);

    await m.DailyTracking.collection.deleteMany({});
    await asSchool(() => terms.remove(String(a.termId)));
    const after = await left();
    expect([after.terms, after.offerings, after.lectures, after.assignments, after.criteria, after.constraints])
      .toEqual([0, 0, 0, 0, 0, 0]);
    expect(after.classes).toBe(1); // classes belong to the year, not the term
  });

  it('a class with attendance is refused; an empty one takes its periods', async () => {
    const a = await year('active');
    const classes = new ClassesService(m.Class, {} as any, m.Lecture, m.Term);
    await m.Attendance.collection.insertOne({ classId: a.classId, schoolId });

    await expect(asSchool(() => classes.remove(String(a.classId)))).rejects.toBeInstanceOf(ConflictException);

    await m.Attendance.collection.deleteMany({});
    await asSchool(() => classes.remove(String(a.classId)));
    expect((await left()).lectures).toBe(0);
  });

  it('a subject offering takes its periods, assignments and distribution', async () => {
    const a = await year('active');
    const offerings = new SubjectOfferingsService(m.SubjectOffering, m.Term, {} as any);

    await asSchool(() => offerings.remove(String(a.offeringId)));
    const after = await left();
    expect([after.offerings, after.lectures, after.assignments, after.criteria]).toEqual([0, 0, 0, 0]);
  });

  describe('leftovers of earlier deletes', () => {
    /** The yamamah case: the year row is gone, everything under it is not. */
    const orphaned = async () => {
      const dead = await year();
      await m.AcademicYear.collection.deleteOne({ _id: dead.yearId });
      return dead;
    };

    it('reports without writing on a dry run', async () => {
      await orphaned();
      await year('active');

      const report = await cleanupLeftovers(conn, schoolId, false);

      expect(report.wouldRemove).toMatchObject({ Lecture: 1, TeacherAssignment: 1, SubjectOffering: 1, Class: 1, Term: 1 });
      expect((await left()).offerings).toBe(2);
    });

    it('removes the dead skeleton and leaves the live year alone', async () => {
      await orphaned();
      const live = await year('active');

      await cleanupLeftovers(conn, schoolId, true);

      expect(await left()).toEqual({
        terms: 1, classes: 1, offerings: 1, lectures: 1, assignments: 1, criteria: 1, constraints: 1,
      });
      expect(await m.SubjectOffering.collection.countDocuments({ _id: live.offeringId })).toBe(1);
    });

    it('keeps a dead offering with an exam, and its distribution, and says so', async () => {
      const dead = await orphaned();
      const criteria = await m.GradesCriteria.collection.findOne({ subjectOfferingId: dead.offeringId });
      await m.Exam.collection.insertOne({ subjectOfferingId: dead.offeringId, gradesCriteriaId: criteria._id,
        classIds: [new Types.ObjectId()], schoolId });

      const report = await cleanupLeftovers(conn, schoolId, true);

      expect(await m.SubjectOffering.collection.countDocuments({ _id: dead.offeringId })).toBe(1);
      expect(await m.GradesCriteria.collection.countDocuments({ _id: criteria._id })).toBe(1);
      expect(report.kept.join(' ')).toContain('1 اختبار');
      // Its dead timetable still goes.
      expect(await m.Lecture.collection.countDocuments({ _id: dead.lectureId })).toBe(0);
    });

    it('keeps a dead period a lesson plan still points at', async () => {
      const dead = await orphaned();
      await m.Preparation.collection.insertOne({ lecture: dead.lectureId, subject: new Types.ObjectId(), schoolId });

      await cleanupLeftovers(conn, schoolId, true);

      expect(await m.Lecture.collection.countDocuments({ _id: dead.lectureId })).toBe(1);
    });

    it('touches no other school', async () => {
      await orphaned();
      const other = new Types.ObjectId();
      await m.Lecture.collection.insertOne({ classId: new Types.ObjectId(), subjectOfferingId: new Types.ObjectId(),
        schoolId: other });

      await cleanupLeftovers(conn, schoolId, true);

      expect(await m.Lecture.collection.countDocuments({ schoolId: other })).toBe(1);
    });
  });
});
