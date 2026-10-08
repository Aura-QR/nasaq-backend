import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { DailyTracking, DailyTrackingSchema } from '../daily-tracking/schemas/daily-tracking.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { ExamResult, ExamResultSchema } from '../exams/schemas/exam-result.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from '../projects/schemas/project-submission.schema';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeRegisterSheet, GradeRegisterSheetSchema } from './schemas/grade-register-sheet.schema';
import { GradeRegisterService } from './grade-register.service';
import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import { ExamsService } from '../exams/exams.service';
import { DailyTrackingService } from '../daily-tracking/daily-tracking.service';
import { assertGradingSystemMayChange } from './grading-system.util';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-grade-register${query}`,
);

/**
 * The ministry grading template: the annual register computed from what
 * teachers already record, typed marks, approval, and promotion from it.
 * See grading-templates-overview.md.
 */
describe('annual register (ministry template)', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const sara = new Types.ObjectId();
  const noura = new Types.ObjectId();
  let continuous: Types.ObjectId; // offering of a continuous subject
  let finalExam: Types.ObjectId; // offering of a final-exam subject

  const asSchool = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const owner = { role: 'OWNER', userId: String(new Types.ObjectId()), name: 'المالك' };
  const teacher = { role: 'TEACHER', userId: String(teacherId) };
  const resolver = { resolveClassIds: async () => [String(classId)] };
  let register: GradeRegisterService;

  beforeAll(async () => {
    const models = [
      [School.name, SchoolSchema], [AcademicYear.name, AcademicYearSchema], [Term.name, TermSchema],
      [Class.name, ClassSchema], [Student.name, StudentSchema], [Subject.name, SubjectSchema],
      [SubjectOffering.name, SubjectOfferingSchema], [Lecture.name, LectureSchema],
      [DailyTracking.name, DailyTrackingSchema], [Attendance.name, AttendanceSchema],
      [Exam.name, ExamSchema], [ExamResult.name, ExamResultSchema], [Project.name, ProjectSchema],
      [ProjectSubmission.name, ProjectSubmissionSchema], [GradesCriteria.name, GradesCriteriaSchema],
      [GradeRegisterSheet.name, GradeRegisterSheetSchema], [GradeLevel.name, GradeLevelSchema],
      [Teacher.name, TeacherSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
    register = new GradeRegisterService(
      m.GradeRegisterSheet, m.SubjectOffering, m.Class, m.Student, m.DailyTracking, m.Attendance,
      m.Exam, m.ExamResult, m.Project, m.ProjectSubmission, m.Lecture, m.Term, resolver as any,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const day = (n: number) => new Date(Date.UTC(2026, 9, n));
  const past = new Date(Date.now() - 86400000);
  const future = new Date(Date.now() + 86400000);

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    await m.School.collection.insertOne({
      _id: schoolId, name: 'س', slug: `s${Math.random()}`, email: 'a@b.c', subscriptionStatus: 'active',
      settings: { gradingSystem: 'ministry', defaultPassingGrade: 50 },
    });
    await m.AcademicYear.collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    await m.Term.collection.insertOne({ _id: termId, academicYearId: yearId, name: 'الأولى', order: 1,
      startDate: day(1), endDate: day(28), status: 'active', schoolId });
    await m.Class.collection.insertOne({ _id: classId, name: 'م1/أ', gradeLevelId: gradeId, academicYearId: yearId,
      gender: 'female', maxCapacity: 30, isActive: true, schoolId });
    await m.Student.collection.insertMany([
      { _id: sara, name: 'سارة', email: 'sara@t.t', classId, isActive: true, schoolId },
      { _id: noura, name: 'نورة', email: 'noura@t.t', classId, isActive: true, schoolId },
    ]);
    const maths = (await m.Subject.collection.insertOne({ subjectName: 'رياضيات', assessmentType: 'continuous', schoolId })).insertedId;
    const science = (await m.Subject.collection.insertOne({ subjectName: 'علوم', assessmentType: 'final_exam', passingGrade: 60, schoolId })).insertedId;
    continuous = (await m.SubjectOffering.collection.insertOne({ subjectId: maths, gradeLevelId: gradeId, termId, schoolId })).insertedId;
    finalExam = (await m.SubjectOffering.collection.insertOne({ subjectId: science, gradeLevelId: gradeId, termId, schoolId })).insertedId;
    await m.Lecture.collection.insertMany([
      { teacherId, classId, subjectOfferingId: continuous, termId, dayOfWeek: 'sunday', slot: 1, schoolId },
      { teacherId, classId, subjectOfferingId: finalExam, termId, dayOfWeek: 'sunday', slot: 2, schoolId },
    ]);
  });

  /** Sara's term in maths: five periods tracked, one of them absent. */
  const saraInMaths = async (offering = continuous) => {
    const rows = [
      { date: day(4), participation: true, homework: true, quizScore: 8, quizMaxScore: 10 },
      { date: day(5), participation: true, homework: true, quizScore: 6, quizMaxScore: 10 },
      { date: day(6), participation: true, homework: false, quizScore: null, quizMaxScore: null },
      { date: day(7), participation: false, homework: false, quizScore: null, quizMaxScore: null },
      // Absent: none of this counts.
      { date: day(8), participation: false, homework: false, quizScore: null, quizMaxScore: null },
    ];
    await m.DailyTracking.collection.insertMany(rows.map((r) => ({
      ...r, studentId: sara, classId, subjectOfferingId: offering, lectureId: new Types.ObjectId(), schoolId,
    })));
    await m.Attendance.collection.insertOne({ studentId: sara, classId, date: day(8), schoolId });
    // An electronic quiz out of 5: Sara 4; Noura never sat it, and it is closed.
    const quiz = (await m.Exam.collection.insertOne({ subjectOfferingId: offering, classIds: [classId], examType: 'quiz',
      grade: 5, endDate: past, schoolId })).insertedId;
    await m.ExamResult.collection.insertOne({ examId: quiz, studentId: sara, startedAt: past, submitted: true, achievedGrade: 4 });
    // Still open: not counted for anyone yet.
    await m.Exam.collection.insertOne({ subjectOfferingId: offering, classIds: [classId], examType: 'quiz',
      grade: 10, endDate: future, schoolId });
  };

  const rowOf = (sheet: any, id: Types.ObjectId) => sheet.data.students.find((s: any) => s.studentId === String(id));

  it('is closed to a school on the flexible system', async () => {
    await m.School.collection.updateOne({ _id: schoolId }, { $set: { 'settings.gradingSystem': 'flexible' } });
    await expect(asSchool(() => register.getSheet(String(classId), String(continuous), owner)))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('works out a continuous subject from tracking and quizzes, absences aside', async () => {
    await saraInMaths();

    const sheet: any = await asSchool(() => register.getSheet(String(classId), String(continuous), owner));
    const row = rowOf(sheet, sara);

    expect(sheet.data.maxScores).toEqual({ performance: 40, written: 60, final: 0 });
    // 4 periods present: participated in 3 (75%), homework in 2 (50%); no tasks → 20 + 20.
    expect(row.performance).toMatchObject({ participationRate: 75, homeworkRate: 50, tasksRate: null, presentPeriods: 4 });
    expect(row.performance.score).toBe(25);
    // Paper 8/10 and 6/10, electronic 4/5: 18 of 25 = 72% of 60.
    expect(row.written).toMatchObject({ rate: 72, count: 3, score: 43.2 });
    expect(row.final).toBeNull();
    expect(row.total).toBe(68.2);
    expect(row.complete).toBe(true);

    // Noura: no tracking at all, a closed quiz unsat (0 of 5).
    const noRow = rowOf(sheet, noura);
    expect(noRow.performance.score).toBeNull();
    expect(noRow.written.score).toBe(0);
    expect(noRow.total).toBeNull();
    expect(noRow.complete).toBe(false);
  });

  it('a final-exam subject: tasks in the 40, the electronic final scaled to 40, a typed mark wins', async () => {
    await saraInMaths(finalExam);
    const fin = (await m.Exam.collection.insertOne({ subjectOfferingId: finalExam, classIds: [classId], examType: 'final',
      grade: 50, endDate: past, schoolId })).insertedId;
    await m.ExamResult.collection.insertMany([
      { examId: fin, studentId: sara, startedAt: past, submitted: true, achievedGrade: 45 },
      { examId: fin, studentId: noura, startedAt: past, submitted: true, achievedGrade: 10 },
    ]);
    const hw = (await m.Exam.collection.insertOne({ subjectOfferingId: finalExam, classIds: [classId], examType: 'assignment',
      grade: 10, endDate: past, schoolId })).insertedId;
    await m.ExamResult.collection.insertOne({ examId: hw, studentId: sara, startedAt: past, submitted: true, achievedGrade: 8 });
    const project = (await m.Project.collection.insertOne({ subjectOfferingId: finalExam, classIds: [classId], grade: 10,
      dueDate: past, title: 'م', description: '', schoolId })).insertedId;
    await m.ProjectSubmission.collection.insertOne({ projectId: project, studentId: sara, achievedGrade: 6, files: [], schoolId });

    await asSchool(() => register.saveMarks({
      classId: String(classId), subjectOfferingId: String(finalExam),
      finalMarks: [{ studentId: String(noura), score: 30 }],
    }, teacher));
    const sheet: any = await asSchool(() => register.getSheet(String(classId), String(finalExam), owner));
    const row = rowOf(sheet, sara);

    // Tasks 14 of 20 (70%): 15 × 75% + 15 × 50% + 10 × 70% = 25.75
    expect(row.performance).toMatchObject({ tasksRate: 70, score: 25.75 });
    // Written 72% of 20.
    expect(row.written.score).toBe(14.4);
    // 45 of 50 = 90% of 40.
    expect(row.final).toEqual({ score: 36, source: 'electronic' });
    expect(row.total).toBe(76.15);
    // Noura's paper mark replaces her electronic one.
    expect(rowOf(sheet, noura).final).toEqual({ score: 30, source: 'manual' });
  });

  it('adds a teacher\'s own written item, and checks every typed mark', async () => {
    await saraInMaths();
    const save = (body: any, who: any = teacher) =>
      asSchool(() => register.saveMarks({ classId: String(classId), subjectOfferingId: String(continuous), ...body }, who));

    const sheet: any = await save({ writtenItems: [{ title: 'ورقة عمل', maxScore: 5, marks: [{ studentId: String(sara), score: 5 }] }] });
    // 18 + 5 of 25 + 5 = 23 of 30.
    expect(rowOf(sheet, sara).written).toMatchObject({ count: 4, rate: 76.7 });
    expect(sheet.data.writtenItems).toHaveLength(1);

    await expect(save({ finalMarks: [{ studentId: String(sara), score: 30 }] })).rejects.toThrow('تقويم مستمر');
    await expect(save({ writtenItems: [{ title: 'ب', maxScore: 5, marks: [{ studentId: String(sara), score: 6 }] }] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(save({ writtenItems: [{ title: 'ب', maxScore: 5, marks: [{ studentId: String(new Types.ObjectId()), score: 1 }] }] }))
      .rejects.toThrow('لا تنتمي');
    await expect(save({ writtenItems: [] }, { role: 'TEACHER', userId: String(new Types.ObjectId()) }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approves only a complete register, freezes it, locks tracking, and reopens', async () => {
    await saraInMaths();
    await expect(asSchool(() => register.approve(String(classId), String(continuous), owner))).rejects.toThrow('غير مكتملة');

    // Noura gets tracked and sits the quiz.
    await m.DailyTracking.collection.insertOne({ studentId: noura, classId, subjectOfferingId: continuous, date: day(4),
      participation: true, homework: true, lectureId: new Types.ObjectId(), schoolId });
    const quiz = await m.Exam.collection.findOne({ grade: 5 });
    await m.ExamResult.collection.insertOne({ examId: quiz._id, studentId: noura, startedAt: past, submitted: true, achievedGrade: 5 });

    const approved: any = await asSchool(() => register.approve(String(classId), String(continuous), owner));
    expect(approved.data.status).toBe('approved');
    expect(approved.data.approvedByName).toBe('المالك');

    // Frozen: a later change to the records does not move it.
    await m.DailyTracking.collection.updateMany({ studentId: sara }, { $set: { participation: true, homework: true } });
    const frozen: any = await asSchool(() => register.getSheet(String(classId), String(continuous), owner));
    expect(rowOf(frozen, sara).total).toBe(68.2);

    // Tracking for this class and subject is locked; typed marks too.
    const tracking = new DailyTrackingService(m.DailyTracking, m.Lecture, m.Student, m.Attendance, {} as any, undefined, m.GradeRegisterSheet);
    await expect(asSchool(() => (tracking as any).assertRegisterOpen(classId, continuous))).rejects.toBeInstanceOf(ConflictException);
    await expect(asSchool(() => register.saveMarks({ classId: String(classId), subjectOfferingId: String(continuous),
      writtenItems: [{ title: 'ج', maxScore: 5 }] }, teacher))).rejects.toBeInstanceOf(ConflictException);

    await asSchool(() => register.reopen(String(classId), String(continuous), owner));
    await expect(asSchool(() => (tracking as any).assertRegisterOpen(classId, continuous))).resolves.toBeUndefined();
    const live: any = await asSchool(() => register.getSheet(String(classId), String(continuous), owner));
    expect(rowOf(live, sara).total).toBeGreaterThan(68.2);
  });

  it('promotion reads the approved register, and the subject\'s own pass mark', async () => {
    await saraInMaths(finalExam);
    const fin = (await m.Exam.collection.insertOne({ subjectOfferingId: finalExam, classIds: [classId], examType: 'final',
      grade: 40, endDate: past, schoolId })).insertedId;
    await m.ExamResult.collection.insertOne({ examId: fin, studentId: sara, startedAt: past, submitted: true, achievedGrade: 20 });
    await asSchool(() => register.saveMarks({ classId: String(classId), subjectOfferingId: String(finalExam),
      finalMarks: [{ studentId: String(noura), score: 40 }],
      writtenItems: [{ title: 'ت', maxScore: 10, marks: [{ studentId: String(noura), score: 10 }] }] }, teacher));
    await m.DailyTracking.collection.insertOne({ studentId: noura, classId, subjectOfferingId: finalExam, date: day(4),
      participation: true, homework: true, lectureId: new Types.ObjectId(), schoolId });
    await asSchool(() => register.approve(String(classId), String(finalExam), owner));

    const grades = new GradesCriteriaService(
      m.GradesCriteria, m.Subject, {} as any, m.Lecture, m.Exam, m.Project, m.Student, m.Class, m.ExamResult,
      m.ProjectSubmission, {} as any, m.SubjectOffering, m.Term, m.School,
      { getSchoolId: () => String(schoolId) } as any, resolver as any, register,
    );
    const results: any[] = await asSchool(() =>
      grades.calculateStudentYearlySubjectResults(String(sara), String(gradeId), String(yearId), [String(classId)]),
    );

    // Science (final-exam, pass 60): Sara 25 + 14.4 + 20 = 59.4 — fails.
    const science = results.find((r) => r.subjectName === 'علوم');
    expect(science).toMatchObject({ finalGrade: 59.4, passingGrade: 60, passed: false });
    // Maths has no approved register: no mark yet, not a failure.
    expect(results.find((r) => r.subjectName === 'رياضيات')).toMatchObject({ finalGrade: null, passed: null });
  });

  it('lets an exam be set without «معايير الدرجات», and no final on a continuous subject', async () => {
    const exams = new ExamsService(m.Exam, m.GradesCriteria, m.Class, m.Lecture, m.Student, m.ExamResult,
      {} as any, m.SubjectOffering, resolver as any, m.AcademicYear);
    const paper = (offering: Types.ObjectId, examType: string, extra: any = {}) => ({
      subjectOfferingId: String(offering), classIds: [String(classId)], examType: examType as any,
      startDate: new Date(), endDate: future, duration: 30,
      questions: [{ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' }], ...extra,
    });

    const quiz: any = await asSchool(() => exams.create(paper(continuous, 'quiz'), teacher));
    expect(quiz.grade ?? (await m.Exam.collection.findOne({})).grade).toBe(10);
    const custom: any = await asSchool(() => exams.create(paper(continuous, 'quiz', { grade: 20 }), teacher));
    expect((await m.Exam.collection.findOne({ _id: new Types.ObjectId(String(custom._id ?? custom.id)) })).grade).toBe(20);

    await expect(asSchool(() => exams.create(paper(continuous, 'final'), teacher))).rejects.toThrow('تقويم مستمر');
    const fin: any = await asSchool(() => exams.create(paper(finalExam, 'final'), teacher));
    expect((await m.Exam.collection.findOne({ _id: new Types.ObjectId(String(fin._id ?? fin.id)) })).grade).toBe(40);
  });

  it('will not switch the grading system once marks exist in the year', async () => {
    await expect(assertGradingSystemMayChange(conn, String(schoolId))).resolves.toBeUndefined();

    const quiz = (await m.Exam.collection.insertOne({ subjectOfferingId: continuous, classIds: [classId], examType: 'quiz',
      grade: 5, endDate: past, schoolId })).insertedId;
    await m.ExamResult.collection.insertOne({ examId: quiz, studentId: sara, startedAt: past, submitted: true, achievedGrade: 4 });

    await expect(assertGradingSystemMayChange(conn, String(schoolId))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('daily tracking keeps a stored quiz mark when an older app saves without one', () => {
    const resolve = DailyTrackingService.resolveRecord;
    expect(resolve({ studentId: 'a', absent: false, quiz: true } as any).quizScore).toBeUndefined();
    expect(resolve({ studentId: 'a', absent: false, quizScore: null } as any).quizScore).toBeNull();
    expect(resolve({ studentId: 'a', absent: false, quizScore: 7 } as any).quizScore).toBe(7);
    // Absent clears it.
    expect(resolve({ studentId: 'a', absent: true, quizScore: 7 } as any).quizScore).toBeNull();
  });

  it('the student sees only approved subjects', async () => {
    await saraInMaths();
    const mine: any = await asSchool(() => register.myRegister({ role: 'STUDENT', userId: String(sara) }));
    expect(mine.data.subjects.map((s: any) => [s.subjectName, s.status, s.total])).toEqual(
      expect.arrayContaining([['رياضيات', 'pending', null], ['علوم', 'pending', null]]),
    );
  });
});
