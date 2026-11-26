import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamResult, ExamResultSchema } from './schemas/exam-result.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from '../projects/schemas/project-submission.schema';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeRegisterSheet, GradeRegisterSheetSchema } from '../grade-register/schemas/grade-register-sheet.schema';
import { GradeRegisterService } from '../grade-register/grade-register.service';
import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import { ExamsService } from './exams.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-makeup-exam${query}`,
);

/**
 * «اختبار بديل»: a maths quiz out of 10 for أولى/أ. Eight students sat it;
 * Reem was absent with an accepted excuse, Razan with none. Ms. Noura gives
 * Reem a makeup; Reem's makeup mark becomes her mark on the quiz itself.
 */
describe('makeup exam', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const classA = new Types.ObjectId();
  const noura = new Types.ObjectId();
  const otherTeacher = new Types.ObjectId();
  const reem = new Types.ObjectId();
  const razan = new Types.ObjectId();
  const sat = Array.from({ length: 8 }, () => new Types.ObjectId());
  let offeringId: Types.ObjectId;
  let criteriaId: Types.ObjectId;
  let quizId: Types.ObjectId;

  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const teacher = (id = noura) => ({ role: 'TEACHER', userId: String(id) });
  const student = (id: Types.ObjectId) => ({ role: 'STUDENT', userId: String(id) });
  const owner = { role: 'OWNER', userId: String(new Types.ObjectId()) };
  const resolver = { resolveClassIds: async () => [String(classA)] };

  const HOUR = 3600_000;
  const examDay = new Date(Date.now() - 2 * 86400_000);

  let notify: jest.Mock;
  let exams: ExamsService;
  let register: GradeRegisterService;
  let grades: GradesCriteriaService;

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
    await m.ExamResult.init();
    register = new GradeRegisterService(
      m.GradeRegisterSheet, m.SubjectOffering, m.Class, m.Student, m.DailyTracking, m.Attendance,
      m.Exam, m.ExamResult, m.Project, m.ProjectSubmission, m.Lecture, m.Term, resolver as any,
    );
    grades = new GradesCriteriaService(
      m.GradesCriteria, m.Subject, m.Teacher, m.Lecture, m.Exam, m.Project, m.Student,
      m.Class, m.ExamResult, m.ProjectSubmission, {} as any, m.SubjectOffering, m.Term,
      m.School, {} as any, resolver as any,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    notify = jest.fn().mockResolvedValue(undefined);
    exams = new ExamsService(
      m.Exam, m.GradesCriteria, m.Class, m.Lecture, m.Student, m.ExamResult,
      {} as any, m.SubjectOffering, resolver as any, m.AcademicYear, { notify } as any, m.Attendance,
    );

    await m.School.collection.insertOne({
      _id: schoolId, name: 'س', slug: `s${Math.random()}`, email: 'a@b.c', subscriptionStatus: 'active',
      settings: { gradingSystem: 'ministry', defaultPassingGrade: 50, timezone: 'Asia/Riyadh' },
    });
    await m.AcademicYear.collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    await m.Term.collection.insertOne({
      _id: termId, academicYearId: yearId, name: 'الأول', order: 1,
      startDate: new Date(Date.now() - 60 * 86400_000), endDate: new Date(Date.now() + 60 * 86400_000), status: 'active', schoolId,
    });
    await m.Class.collection.insertOne({
      _id: classA, name: 'أولى/أ', gradeLevelId: gradeId, academicYearId: yearId, gender: 'female', maxCapacity: 30, isActive: true, schoolId,
    });
    await m.Student.collection.insertMany([
      { _id: reem, name: 'ريم', email: 'reem@t.t', classId: classA, isActive: true, schoolId },
      { _id: razan, name: 'رزان', email: 'razan@t.t', classId: classA, isActive: true, schoolId },
      ...sat.map((_id, i) => ({ _id, name: `طالبة ${i + 1}`, email: `s${i}@t.t`, classId: classA, isActive: true, schoolId })),
    ]);
    const subjectId = (await m.Subject.collection.insertOne({ subjectName: 'الرياضيات', assessmentType: 'continuous', schoolId })).insertedId;
    offeringId = (await m.SubjectOffering.collection.insertOne({ subjectId, gradeLevelId: gradeId, termId, schoolId })).insertedId;
    await m.Lecture.collection.insertOne({ teacherId: noura, classId: classA, subjectOfferingId: offeringId, schoolId });
    criteriaId = (await m.GradesCriteria.collection.insertOne({
      subjectOfferingId: offeringId, final: 40, assignments: 20, assignmentsCount: 1,
      activities: 10, projects: 10, projectsCount: 1, quizzes: 10, quizzesCount: 1, schoolId,
    })).insertedId;

    // Sunday's quiz, out of 10: five questions at 2. Closed.
    quizId = (await m.Exam.collection.insertOne({
      gradesCriteriaId: criteriaId, subjectOfferingId: offeringId, classIds: [classA], examType: 'quiz', grade: 10,
      createdBy: noura, startDate: examDay, endDate: new Date(examDay.getTime() + 8 * HOUR), duration: 20,
      makeupOf: null, studentIds: [], schoolId,
      questions: [1, 2, 3, 4, 5].map((n) => ({
        _id: new Types.ObjectId(), type: 'mcq', question: `س${n}`, options: ['1', '2'], correctAnswer: '1', marks: 2,
      })),
    })).insertedId;
    for (const sid of sat) {
      await m.ExamResult.collection.insertOne({ examId: quizId, studentId: sid, startedAt: examDay, submitted: true, status: 'graded', achievedGrade: 7, schoolId });
    }
    // Absent that day: Reem excused, Razan not.
    const day = new Date(examDay);
    day.setUTCHours(0, 0, 0, 0);
    await m.Attendance.collection.insertMany([
      { studentId: reem, classId: classA, date: day, excuseStatus: 'accepted', schoolId },
      { studentId: razan, classId: classA, date: day, excuseStatus: null, schoolId },
    ]);
    // A tracked period each, so a row can be complete.
    await m.DailyTracking.collection.insertMany([reem, razan].map((studentId) => ({
      studentId, classId: classA, subjectOfferingId: offeringId, lectureId: new Types.ObjectId(),
      date: new Date(examDay.getTime() - 86400_000), participation: true, homework: true, schoolId,
    })));
  });

  const makeup = (over: any = {}, who: any = teacher()) =>
    asSchool(() =>
      exams.createMakeup(String(quizId), {
        studentIds: [String(reem)],
        startDate: new Date(Date.now() - HOUR).toISOString(),
        endDate: new Date(Date.now() + 2 * HOUR).toISOString(),
        duration: 20,
        copyQuestions: true,
        ...over,
      }, who),
    );

  const sitMakeup = async (makeupId: any, who: Types.ObjectId, right: number) =>
    asSchool(async () => {
      const started: any = await exams.startExam(String(makeupId), student(who));
      const qs = started.data.exam.questions;
      return exams.gradeExam(String(makeupId), {
        answers: qs.map((q: any, i: number) => ({ questionId: String(q._id), answer: i < right ? '1' : '2' })),
      } as any, student(who));
    });

  const sheet = () => asSchool(() => register.getSheet(String(classA), String(offeringId), owner));
  const rowOf = (s: any, id: Types.ObjectId) => s.data.students.find((x: any) => x.studentId === String(id));

  // ─────────────────────────────────────────── 1. the scenario

  it('1. Reem (excused) and Razan (unexcused) are offered; Reem\'s makeup 8/10 is her quiz mark', async () => {
    const candidates: any = await asSchool(() => exams.makeupCandidates(String(quizId), teacher()));
    expect(candidates.data.candidates.map((c: any) => [c.name, c.absence, c.className])).toEqual([
      ['ريم', 'excused', 'أولى/أ'],
      ['رزان', 'unexcused', 'أولى/أ'],
    ]);
    expect(candidates.data.candidates[0].absenceDates).toHaveLength(1);

    const created: any = await makeup();
    const mk = created.data;
    expect(String(mk.makeupOf)).toBe(String(quizId));
    expect(mk.studentIds.map(String)).toEqual([String(reem)]);
    expect(mk).toMatchObject({ examType: 'quiz', grade: 10 });
    const original: any = await m.Exam.collection.findOne({ _id: quizId });
    const originalIds = new Set(original.questions.map((q: any) => String(q._id)));
    expect(mk.questions).toHaveLength(5);
    expect(mk.questions.some((q: any) => originalIds.has(String(q._id)))).toBe(false);
    expect(mk.questions[0]).toMatchObject({ correctAnswer: '1', marks: 2, type: 'mcq' });

    // Only Reem sees it.
    const reemList: any = await asSchool(() => exams.getMyExams(String(reem)));
    const mine = reemList.data.find((e: any) => e.isMakeup);
    expect(String(mine._id)).toBe(String(mk._id));
    expect(mine).not.toHaveProperty('studentIds');
    expect(reemList.data.find((e: any) => String(e._id) === String(quizId)).makeupExamId).toBe(String(mk._id));
    const razanList: any = await asSchool(() => exams.getMyExams(String(razan)));
    expect(razanList.data.map((e: any) => String(e._id))).toEqual([String(quizId)]);

    // Now she is shown as scheduled.
    const after: any = await asSchool(() => exams.makeupCandidates(String(quizId), teacher()));
    expect(after.data.candidates[0].makeup).toMatchObject({ examId: String(mk._id), status: 'scheduled' });

    // Reem sits it: 4 of 5 = 8/10.
    const res: any = await sitMakeup(mk._id, reem, 4);
    expect(res.achievedGrade).toBe(8);

    const s: any = await sheet();
    // One quiz, one mark: 8 of 10 for Reem; Razan 0. No extra column.
    expect(rowOf(s, reem).written).toMatchObject({ count: 1, rate: 80 });
    expect(rowOf(s, reem).complete).toBe(true);
    expect(rowOf(s, razan).written).toMatchObject({ count: 1, score: 0 });

    const taken: any = await asSchool(() => exams.makeupCandidates(String(quizId), teacher()));
    expect(taken.data.candidates[0].makeup.status).toBe('taken');
  });

  // ─────────────────────────────────────────── 2. validation

  describe('2. validation', () => {
    it('refuses a student who sat the original, or one already in an open makeup', async () => {
      await expect(makeup({ studentIds: [String(sat[0])] })).rejects.toThrow('أدّت الاختبار الأصلي');
      await makeup();
      await expect(makeup()).rejects.toThrow('ريم لديها اختبار بديل قائم');
    });

    it('refuses a makeup of a makeup, and an end in the past', async () => {
      const mk: any = await makeup();
      await expect(asSchool(() =>
        exams.createMakeup(String(mk.data._id), {
          studentIds: [String(razan)], startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + HOUR).toISOString(), duration: 20, copyQuestions: true,
        }, teacher()),
      )).rejects.toThrow('لا يكون للاختبار البديل اختبار بديل');
      await expect(makeup({
        studentIds: [String(razan)],
        startDate: new Date(Date.now() - 3 * HOUR).toISOString(),
        endDate: new Date(Date.now() - HOUR).toISOString(),
      })).rejects.toThrow(BadRequestException);
    });

    it('ignores the count limit: the one quiz allowed is already set, and the makeup is still created', async () => {
      // quizzesCount is 1 and the quiz exists.
      const mk: any = await makeup();
      expect(mk.data._id).toBeDefined();
    });

    it('a teacher of another subject offering gets 403; her own questions follow the usual rules', async () => {
      await expect(makeup({}, teacher(otherTeacher))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(makeup({ copyQuestions: false, questions: [] })).rejects.toThrow(BadRequestException);
      await expect(makeup({ copyQuestions: false, questions: [{ type: 'essay', question: 'س', options: ['أ', 'ب'] }] }))
        .rejects.toThrow('سؤال المقالي لا يحتوي على خيارات');
    });
  });

  // ─────────────────────────────────────────── 3. sitting

  it('3. another student opening the makeup by id gets 403; Reem cannot sit the original', async () => {
    const mk: any = await makeup();
    await expect(asSchool(() => exams.startExam(String(mk.data._id), student(razan))))
      .rejects.toThrow('هذا الاختبار البديل غير مخصص لك');
    // Reopened for the sake of the test, so the only thing in the way is the makeup.
    await m.Exam.collection.updateOne({ _id: quizId }, { $set: { endDate: new Date(Date.now() + HOUR) } });
    await expect(asSchool(() => exams.startExam(String(quizId), student(reem))))
      .rejects.toThrow('لديك اختبار بديل لهذا الاختبار');
  });

  // ─────────────────────────────────────────── 4. variant 7

  it('4. before the makeup ends Reem\'s quiz is not held (row incomplete); after it, 0', async () => {
    const mk: any = await makeup();
    const open: any = await sheet();
    expect(rowOf(open, reem).written.count).toBe(0);
    expect(rowOf(open, reem).complete).toBe(false);

    await m.Exam.collection.updateOne({ _id: mk.data._id }, { $set: { endDate: new Date(Date.now() - 60_000) } });
    const closed: any = await sheet();
    expect(rowOf(closed, reem).written).toMatchObject({ count: 1, score: 0 });
    expect(rowOf(closed, reem).complete).toBe(true);
  });

  // ─────────────────────────────────────────── 5. essay

  it('5. an essay in a makeup stays pending until marked, and the row with it', async () => {
    const mk: any = await makeup({
      copyQuestions: false,
      questions: [
        { type: 'mcq', question: 'س', options: ['1', '2'], correctAnswer: '1', marks: 5 },
        { type: 'essay', question: 'اشرح', modelAnswer: 'ن', marks: 5 },
      ],
    });
    const makeupId = String(mk.data._id);
    await asSchool(async () => {
      const started: any = await exams.startExam(makeupId, student(reem));
      const [q1, q2] = started.data.exam.questions;
      await exams.gradeExam(makeupId, { answers: [
        { questionId: String(q1._id), answer: '1' }, { questionId: String(q2._id), answer: 'جواب' },
      ] } as any, student(reem));
    });
    await m.Exam.collection.updateOne({ _id: mk.data._id }, { $set: { endDate: new Date(Date.now() - 60_000) } });

    const pending: any = await sheet();
    expect(rowOf(pending, reem).complete).toBe(false);
    expect(rowOf(pending, reem).written.count).toBe(0);

    const review: any = await asSchool(() => exams.getReview(makeupId, undefined, teacher()));
    const essay = review.data.questions[0];
    await asSchool(() => exams.reviewAnswers(makeupId, {
      grades: [{ studentId: String(reem), questionId: essay.questionId, earned: 3 }],
    }, teacher()));
    const marked: any = await sheet();
    // 5 + 3 of 10.
    expect(rowOf(marked, reem).written).toMatchObject({ count: 1, rate: 80 });
    expect(rowOf(marked, reem).complete).toBe(true);
  });

  // ─────────────────────────────────────────── 6. lists

  it('6. makeups nest under their original; the original\'s sheet has Reem\'s makeup row', async () => {
    const mk: any = await makeup();
    await sitMakeup(mk.data._id, reem, 4);

    const list: any = await asSchool(() => exams.filtering({}, {}, teacher()));
    expect(list.map((e: any) => String(e._id))).toEqual([String(quizId)]);
    expect(list[0].makeups).toEqual([
      expect.objectContaining({ _id: mk.data._id, studentCount: 1, takenCount: 1 }),
    ]);

    const results: any = await asSchool(() => exams.listResults(String(quizId), teacher()));
    const row = results.data.results.find((r: any) => String(r.studentId) === String(reem));
    expect(row).toMatchObject({ achievedGrade: 8, fromMakeup: String(mk.data._id) });
    // Her answers are read against the makeup's own questions (new ids), not the original's.
    const makeupQuestionIds = mk.data.questions.map((q: any) => String(q._id));
    expect(row.answers.map((a: any) => String(a.questionId))).toEqual(makeupQuestionIds);
    expect(row.answers[0]).toMatchObject({ type: 'mcq', correctAnswer: '1', marks: 2, earned: 2 });
    expect(results.data.results).toHaveLength(9);
    expect(results.data.results.filter((r: any) => r.fromMakeup)).toHaveLength(1);

    // It still opens by its own id.
    const byId: any = await asSchool(() => exams.findOne(String(mk.data._id), teacher()));
    expect(String(byId.makeupOf)).toBe(String(quizId));

    // The original cannot be deleted from under it.
    await m.ExamResult.collection.deleteMany({ examId: quizId });
    await expect(asSchool(() => exams.remove(String(quizId), teacher()))).rejects.toThrow('احذف الاختبار البديل أولًا');
  });

  // ─────────────────────────────────────────── 7. flexible template

  it('7. flexible: the makeup mark is the quiz mark, open means upcoming, and the count ignores makeups', async () => {
    await m.School.collection.updateOne({ _id: schoolId }, { $set: { 'settings.gradingSystem': 'flexible' } });
    const mk: any = await makeup();
    const criteria = await asSchool(() => m.GradesCriteria.findById(criteriaId).exec());

    const before: any = await asSchool(() => (grades as any).termItemsForStudent(String(reem), String(offeringId), criteria, [String(classA)]));
    expect(before.examStatus(String(quizId))).toBe('upcoming');
    expect(before.byType.quiz).toEqual([String(quizId)]);

    await sitMakeup(mk.data._id, reem, 4);
    const term: any = await asSchool(() => grades.calculateStudentTermGrade(String(reem), String(offeringId), [String(classA)]));
    expect(term.finalGrade).toBe(8);
    const after: any = await asSchool(() => (grades as any).termItemsForStudent(String(reem), String(offeringId), criteria, [String(classA)]));
    expect(after.examStatus(String(quizId))).toBe('graded');

    // Two exam documents, one exam.
    await expect(asSchool(() => grades.remove(String(criteriaId)))).rejects.toThrow('1 اختبار');
  });

  // ─────────────────────────────────────────── 8. notifications

  it('8. notified on create and when added; not when removed; a student who started cannot be removed', async () => {
    const mk: any = await makeup();
    const scheduled = () => notify.mock.calls.map((c) => c[0]).filter((n) => n.type === 'makeup_exam_scheduled');
    expect(scheduled()).toHaveLength(1);
    expect(scheduled()[0]).toMatchObject({
      recipientId: String(reem),
      title: 'اختبار بديل',
      data: { examId: String(mk.data._id), makeupOf: String(quizId), subjectName: 'الرياضيات' },
    });
    expect(scheduled()[0].body).toMatch(/^حُدِّد لكِ اختبار بديل في الرياضيات من \d{4}-\d{2}-\d{2} \d{2}:\d{2} إلى .+، ومدته 20 دقيقة\.$/);

    // Razan added.
    await asSchool(() => exams.update(String(mk.data._id), { studentIds: [String(reem), String(razan)] } as any, teacher()));
    expect(scheduled().map((n) => n.recipientId)).toEqual([String(reem), String(razan)]);

    // Razan removed: nobody told.
    await asSchool(() => exams.update(String(mk.data._id), { studentIds: [String(reem)] } as any, teacher()));
    expect(scheduled()).toHaveLength(2);

    // Reem has started it: she stays.
    await asSchool(() => exams.startExam(String(mk.data._id), student(reem)));
    await expect(asSchool(() => exams.update(String(mk.data._id), { studentIds: [String(razan)] } as any, teacher())))
      .rejects.toThrow('ريم بدأت الاختبار البديل');
    // What the makeup copied stays the original's.
    await expect(asSchool(() => exams.update(String(mk.data._id), { grade: 20 } as any, teacher())))
      .rejects.toThrow(BadRequestException);
  });

  it('9. the edit form re-sends the copied fields unchanged: the save goes through', async () => {
    const mk: any = await makeup();
    const same = {
      subjectOfferingId: String(mk.data.subjectOfferingId),
      classIds: mk.data.classIds.map(String),
      examType: mk.data.examType,
      grade: mk.data.grade,
      duration: 25,
    };
    const saved: any = await asSchool(() => exams.update(String(mk.data._id), same as any, teacher()));
    expect(saved.duration).toBe(25);
    await expect(asSchool(() => exams.update(String(mk.data._id), { ...same, examType: 'assignment' } as any, teacher())))
      .rejects.toThrow('تُنسخ من الاختبار الأصلي');
  });
});
