import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamResult, ExamResultSchema } from './schemas/exam-result.schema';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { ProjectsService } from '../projects/projects.service';
import { ProjectsController } from '../projects/projects.controller';
import { CHECK_ABILITY } from '../casl/decorators/check-abilities.decorator';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from '../projects/schemas/project-submission.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-final-exam-per-grade${query}`,
);

/**
 * One subject, one grade, two sections, two teachers.
 *
 * The term grade took the first final created anywhere in the grade, so a
 * student in the second teacher's section was scored on a paper set for the
 * other section — one she never sat — and got 0. The same ran through the
 * quizzes, taken in creation order across the grade.
 *
 * The final is now the grade's, set once by any teacher of the subject there
 * and shared by all of them; every other exam counts only for the classes it
 * was set for.
 */
describe('exams — the final is the grade\'s, grades count the student\'s own class', () => {
  let moduleRef: TestingModule;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const offeringId = new Types.ObjectId();
  const classA = new Types.ObjectId();
  const classB = new Types.ObjectId();
  const teacherA = new Types.ObjectId();
  const teacherB = new Types.ObjectId();
  const studentA = new Types.ObjectId();
  const studentB = new Types.ObjectId();
  let criteriaId: Types.ObjectId;

  const classOf: Record<string, string[]> = {
    [String(studentA)]: [String(classA)],
    [String(studentB)]: [String(classB)],
  };
  const resolver = { resolveClassIds: async (id: any) => classOf[String(id)] ?? [] };
  const asSchool = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const teacher = (id: Types.ObjectId) => ({ role: 'TEACHER', userId: String(id) });

  let exams: ExamsService;
  let grades: GradesCriteriaService;

  beforeAll(async () => {
    const models = [
      [Exam.name, ExamSchema], [ExamResult.name, ExamResultSchema],
      [GradesCriteria.name, GradesCriteriaSchema], [Class.name, ClassSchema],
      [Lecture.name, LectureSchema], [SubjectOffering.name, SubjectOfferingSchema],
      [Term.name, TermSchema], [Project.name, ProjectSchema],
      [ProjectSubmission.name, ProjectSubmissionSchema],
      // Populated by the responses only.
      [Subject.name, SubjectSchema], [Teacher.name, TeacherSchema], [GradeLevel.name, GradeLevelSchema],
      [AcademicYear.name, AcademicYearSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    for (const [name] of models) m[name] = moduleRef.get(getModelToken(name));

    exams = new ExamsService(
      m.Exam, m.GradesCriteria, m.Class, m.Lecture, {} as any, m.ExamResult,
      {} as any, m.SubjectOffering, resolver as any, m.AcademicYear,
    );
    grades = new GradesCriteriaService(
      m.GradesCriteria, {} as any, {} as any, m.Lecture, m.Exam, m.Project, {} as any,
      m.Class, m.ExamResult, m.ProjectSubmission, {} as any, m.SubjectOffering, m.Term,
      {} as any, {} as any, resolver as any,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    await m.Term.collection.insertOne({
      _id: termId, academicYearId: yearId, name: 'الأول', order: 1,
      startDate: new Date('2026-08-30'), endDate: new Date('2027-01-10'), status: 'active', schoolId,
    });
    await m.SubjectOffering.collection.insertOne({
      _id: offeringId, subjectId: new Types.ObjectId(), gradeLevelId: gradeId, termId, schoolId,
    });
    for (const _id of [classA, classB]) {
      await m.Class.collection.insertOne({
        _id, name: String(_id), gradeLevelId: gradeId, academicYearId: yearId,
        gender: 'female', maxCapacity: 30, isActive: true, schoolId,
      });
    }
    await m.Lecture.collection.insertMany([
      { teacherId: teacherA, subjectOfferingId: offeringId, classId: classA, schoolId },
      { teacherId: teacherB, subjectOfferingId: offeringId, classId: classB, schoolId },
    ]);
    criteriaId = (await m.GradesCriteria.collection.insertOne({
      subjectOfferingId: offeringId, final: 40, assignments: 20, assignmentsCount: 1,
      activities: 10, projects: 10, projectsCount: 1, quizzes: 20, quizzesCount: 2, schoolId,
    })).insertedId;
  });

  const paper = (examType: string, classIds: string[]) => ({
    subjectOfferingId: String(offeringId), classIds, examType: examType as any,
    startDate: new Date(), endDate: new Date(Date.now() + 86400000), duration: 30,
    questions: [{ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' }],
  });

  /** An exam as the old code stored it — set for one section only. */
  const legacyExam = async (examType: string, classId: Types.ObjectId, by: Types.ObjectId, grade: number) =>
    (await m.Exam.collection.insertOne({
      gradesCriteriaId: criteriaId, subjectOfferingId: offeringId, classIds: [classId], examType,
      grade, createdBy: by, startDate: new Date(), endDate: new Date(), duration: 30,
      questions: [], schoolId, createdAt: new Date(Date.now() - 1000), updatedAt: new Date(),
    })).insertedId;

  const result = (examId: Types.ObjectId, studentId: Types.ObjectId, achievedGrade: number) =>
    m.ExamResult.collection.insertOne({
      examId, studentId, startedAt: new Date(), submitted: true, achievedGrade, schoolId,
    });

  it('scores each student on her own section\'s final and quizzes', async () => {
    // Section A's papers are created first — the order that used to win.
    const finalA = await legacyExam('final', classA, teacherA, 40);
    const quizA1 = await legacyExam('quiz', classA, teacherA, 10);
    const quizA2 = await legacyExam('quiz', classA, teacherA, 10);
    const finalB = await legacyExam('final', classB, teacherB, 40);
    const quizB1 = await legacyExam('quiz', classB, teacherB, 10);
    await result(finalA, studentA, 30);
    await result(quizA1, studentA, 5);
    await result(quizA2, studentA, 6);
    await result(finalB, studentB, 38);
    await result(quizB1, studentB, 9);

    const a = await asSchool(() => grades.calculateStudentTermGrade(String(studentA), String(offeringId)));
    const b = await asSchool(() => grades.calculateStudentTermGrade(String(studentB), String(offeringId)));

    expect(a.finalGrade).toBe(30 + 5 + 6);
    expect(b.finalGrade).toBe(38 + 9);
  });

  it('promotion reads the class given, not the current one', async () => {
    const finalA = await legacyExam('final', classA, teacherA, 40);
    await legacyExam('final', classB, teacherB, 40);
    await result(finalA, studentB, 35); // sat it in section A last year

    const b = await asSchool(() =>
      grades.calculateStudentTermGrade(String(studentB), String(offeringId), [String(classA)]),
    );
    expect(b.finalGrade).toBe(35);
  });

  it('sets a final for every class of the grade, whoever creates it', async () => {
    const created: any = await asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA)));
    const stored = await m.Exam.collection.findOne({ _id: new Types.ObjectId(String(created._id ?? created.id)) });

    expect(stored.classIds.map(String).sort()).toEqual([String(classA), String(classB)].sort());
  });

  it('refuses a second final for the same subject and grade', async () => {
    await asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA)));

    await expect(
      asSchool(() => exams.create(paper('final', [String(classB)]), teacher(teacherB))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a final from a teacher who does not teach the subject in that grade', async () => {
    await expect(
      asSchool(() => exams.create(paper('final', [String(classA)]), teacher(new Types.ObjectId()))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the other teacher of the subject see, edit and add questions to the final', async () => {
    const created: any = await asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA)));
    const id = String(created._id ?? created.id);

    const listed: any = await asSchool(() => exams.filtering({}, {}, teacher(teacherB)));
    expect(listed.map((e: any) => String(e._id ?? e.id))).toContain(id);

    await asSchool(() => exams.update(id, { duration: 45, classIds: [String(classB)] } as any, teacher(teacherB)));
    await asSchool(() =>
      exams.addQuestion(id, { question: 'س٢', options: ['أ', 'ب'], correctAnswer: 'ب' }, teacher(teacherB)),
    );
    const stored = await m.Exam.collection.findOne({ _id: new Types.ObjectId(id) });
    expect(stored.duration).toBe(45);
    expect(stored.questions).toHaveLength(2);
    // Still the whole grade's: the edit could not narrow it to one section.
    expect(stored.classIds).toHaveLength(2);
  });

  it('keeps a quiz its author\'s alone', async () => {
    const quiz: any = await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));
    const id = String(quiz._id ?? quiz.id);

    await expect(asSchool(() => exams.update(id, { duration: 5 } as any, teacher(teacherB))))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(asSchool(() => exams.remove(id, teacher(teacherB))))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      asSchool(() => exams.addQuestion(id, { question: 'س', options: ['أ'], correctAnswer: 'أ' }, teacher(teacherB))),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const listed: any = await asSchool(() => exams.filtering({}, {}, teacher(teacherB)));
    expect(listed.map((e: any) => String(e._id ?? e.id))).not.toContain(id);
  });

  it('lets a teacher correct a mark only for a student in her own section', async () => {
    const created: any = await asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA)));
    const id = new Types.ObjectId(String(created._id ?? created.id));
    await result(id, studentB, 20);
    exams['studentModel'] = { findById: () => ({ exec: async () => ({ _id: studentB }) }) } as any;

    await expect(asSchool(() => exams.editStudentGrade(String(id), String(studentB), 25, teacher(teacherA))))
      .rejects.toBeInstanceOf(ForbiddenException);
    const ok: any = await asSchool(() => exams.editStudentGrade(String(id), String(studentB), 25, teacher(teacherB)));
    expect(ok.data.achievedGrade).toBe(25);
  });

  // ───────────────────────────── sitting, marking, and the distribution

  const student = (id: Types.ObjectId) => ({ role: 'STUDENT', userId: String(id) });
  const twoQuestions = () => ({
    ...paper('quiz', [String(classA)]),
    questions: [
      { question: 'س١', options: ['أ', 'ب'], correctAnswer: 'أ' },
      { question: 'س٢', options: ['أ', 'ب'], correctAnswer: 'ب' },
    ],
  });
  const sit = async () => {
    const quiz: any = await asSchool(() => exams.create(twoQuestions(), teacher(teacherA)));
    const id = String(quiz._id ?? quiz.id);
    const started: any = await asSchool(() => exams.startExam(id, student(studentA)));
    const [q1] = started.data.exam.questions.map((q: any) => String(q._id));
    return { id, q1 };
  };

  it('counts each question once, however often its answer is sent', async () => {
    const { id, q1 } = await sit();
    const answers = Array.from({ length: 20 }, () => ({ questionId: q1, answer: 'أ' }));

    const marked: any = await asSchool(() => exams.gradeExam(id, { answers } as any, student(studentA)));

    // One of two right: half of the quiz's 10, never 20 × 10.
    expect(marked.percentage).toBe(50);
    expect(marked.achievedGrade).toBe(5);
  });

  it('lets only a student of the exam\'s classes open it', async () => {
    const quiz: any = await asSchool(() => exams.create(twoQuestions(), teacher(teacherA)));
    const id = String(quiz._id ?? quiz.id);

    await expect(asSchool(() => exams.startExam(id, student(studentB))))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(asSchool(() => exams.startExam(id, teacher(teacherA))))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a paper that lands just after the timer, and refuses one long after', async () => {
    const { id, q1 } = await sit();
    const answers = [{ questionId: q1, answer: 'أ' }];
    const backdate = (minutes: number) =>
      m.ExamResult.collection.updateOne(
        { examId: new Types.ObjectId(id) },
        { $set: { startedAt: new Date(Date.now() - minutes * 60000), submitted: false } },
      );

    await backdate(30 + 4); // 30-minute paper, 4 minutes over
    await expect(asSchool(() => exams.gradeExam(id, { answers } as any, student(studentA))))
      .rejects.toBeInstanceOf(BadRequestException);

    await backdate(30.5); // the auto-submit, half a minute late
    const marked: any = await asSchool(() => exams.gradeExam(id, { answers } as any, student(studentA)));
    expect(marked.achievedGrade).toBe(5);
  });

  it('accepts a paper once', async () => {
    const { id, q1 } = await sit();
    const answers = [{ questionId: q1, answer: 'أ' }];
    await asSchool(() => exams.gradeExam(id, { answers } as any, student(studentA)));

    await expect(asSchool(() => exams.gradeExam(id, { answers } as any, student(studentA))))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('freezes the questions once a student has opened the paper', async () => {
    const { id, q1 } = await sit();

    await expect(asSchool(() =>
      exams.updateQuestion(id, q1, { correctAnswer: 'ب' } as any, teacher(teacherA)),
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(asSchool(() =>
      exams.addQuestion(id, { question: 'س٣', options: ['أ'], correctAnswer: 'أ' }, teacher(teacherA)),
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(asSchool(() =>
      exams.update(id, { questions: [] } as any, teacher(teacherA)),
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stops at the number of quizzes the distribution counts, per class', async () => {
    await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));
    await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));

    await expect(asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA))))
      .rejects.toBeInstanceOf(BadRequestException);
    // The other section has its own two.
    await asSchool(() => exams.create(paper('quiz', [String(classB)]), teacher(teacherB)));
  });

  it('will not delete a distribution with exams set against it', async () => {
    await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));

    await expect(asSchool(() => grades.remove(String(criteriaId))))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await m.Exam.collection.countDocuments({})).toBe(1);
    expect(await m.GradesCriteria.collection.countDocuments({})).toBe(1);
  });

  it('will not change a weight or count under exams already set, and changes the rest', async () => {
    await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));

    await expect(asSchool(() =>
      grades.update(String(criteriaId), { quizzes: 10, final: 50 } as any),
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(asSchool(() =>
      grades.update(String(criteriaId), { quizzesCount: 1 } as any),
    )).rejects.toBeInstanceOf(BadRequestException);

    // No final or activity exam yet, so those two may trade weight.
    await asSchool(() => grades.update(String(criteriaId), { final: 30, activities: 20, passingGrade: 60 } as any));
    const stored = await m.GradesCriteria.collection.findOne({ _id: criteriaId });
    expect([stored.final, stored.activities, stored.passingGrade]).toEqual([30, 20, 60]);
  });

  it('will not delete an exam students have opened', async () => {
    const { id } = await sit();

    await expect(asSchool(() => exams.remove(id, teacher(teacherA))))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await m.Exam.collection.countDocuments({})).toBe(1);
  });

  it('keeps every student\'s results and submissions away from students', () => {
    const ability = (cls: any, name: string) => Reflect.getMetadata(CHECK_ABILITY, cls.prototype[name]);
    expect(ability(ExamsController, 'listResults')).toEqual([{ action: 'read', subject: 'Exam' }]);
    expect(ability(ProjectsController, 'listSubmissions')).toEqual([{ action: 'read', subject: 'Project' }]);
    expect(ability(ProjectsController, 'downloadSubmission')).toEqual([{ action: 'read', subject: 'Project' }]);
  });

  describe('an offering left behind by a deleted year', () => {
    it('is refused — its exam would go to last year\'s classes', async () => {
      // The yamamah report: the year and its term were deleted, the offering,
      // the teacher's old lecture and assignment were not.
      await m.Term.collection.deleteMany({});

      await expect(asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA))))
        .rejects.toThrow('فصل دراسي محذوف');
      await expect(asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA))))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('is refused when its year is not the active one', async () => {
      await m.AcademicYear.collection.insertOne({ name: '2027/2028', status: 'active', schoolId });

      await expect(asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA))))
        .rejects.toThrow('عام دراسي غير العام الحالي');
    });

    it('is accepted in the active year', async () => {
      await m.AcademicYear.collection.insertOne({ _id: yearId, name: '2026/2027', status: 'active', schoolId });

      const created: any = await asSchool(() => exams.create(paper('final', [String(classA)]), teacher(teacherA)));
      const stored = await m.Exam.collection.findOne({ _id: new Types.ObjectId(String(created._id ?? created.id)) });
      expect(stored.classIds.map(String).sort()).toEqual([String(classA), String(classB)].sort());
    });
  });

  describe('a paper never handed in', () => {
    const backdate = (id: string, minutes: number) =>
      m.ExamResult.collection.updateOne(
        { examId: new Types.ObjectId(id) },
        { $set: { startedAt: new Date(Date.now() - minutes * 60000) } },
      );
    const stored = (id: string) => m.ExamResult.collection.findOne({ examId: new Types.ObjectId(id) });

    it('is marked from the answers she saved once her time runs out', async () => {
      const { id, q1 } = await sit();
      await asSchool(() => exams.saveAnswers(id, { answers: [{ questionId: q1, answer: 'أ' }] } as any, student(studentA)));
      await backdate(id, 40); // 30-minute paper; the app closed and never came back

      const closed = await asSchool(() => exams.sweepExpiredSessions());

      expect(closed).toBe(1);
      const row = await stored(id);
      expect(row.submitted).toBe(true);
      expect(row.autoSubmitted).toBe(true);
      expect(row.achievedGrade).toBe(5); // one of two right
    });

    it('leaves a paper still in time alone', async () => {
      const { id, q1 } = await sit();
      await asSchool(() => exams.saveAnswers(id, { answers: [{ questionId: q1, answer: 'أ' }] } as any, student(studentA)));

      expect(await asSchool(() => exams.sweepExpiredSessions())).toBe(0);
      expect((await stored(id)).submitted).toBe(false);
    });

    it('marks what was saved when the submission itself comes too late', async () => {
      const { id, q1 } = await sit();
      await asSchool(() => exams.saveAnswers(id, { answers: [{ questionId: q1, answer: 'أ' }] } as any, student(studentA)));
      await backdate(id, 40);

      await expect(asSchool(() => exams.gradeExam(id, { answers: [] } as any, student(studentA))))
        .rejects.toBeInstanceOf(BadRequestException);
      expect((await stored(id)).achievedGrade).toBe(5);
    });

    it('on reopening, counts the time from when she first opened it', async () => {
      const { id } = await sit();
      await backdate(id, 10); // 30-minute paper opened 10 minutes ago

      const again: any = await asSchool(() => exams.startExam(id, student(studentA)));

      // About 20 minutes left, not the full 30.
      expect(again.data.remainingSeconds).toBeGreaterThan(19 * 60);
      expect(again.data.remainingSeconds).toBeLessThanOrEqual(20 * 60);
    });

    it('never counts past the exam\'s own end', async () => {
      const { id } = await sit();
      await m.Exam.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { endDate: new Date(Date.now() + 5 * 60000) } });

      const again: any = await asSchool(() => exams.startExam(id, student(studentA)));

      expect(again.data.remainingSeconds).toBeLessThanOrEqual(5 * 60);
    });

    it('gives back the saved answers when she reopens the paper in time', async () => {
      const { id, q1 } = await sit();
      await asSchool(() => exams.saveAnswers(id, { answers: [{ questionId: q1, answer: 'ب' }] } as any, student(studentA)));

      const again: any = await asSchool(() => exams.startExam(id, student(studentA)));
      expect(again.data.savedAnswers).toEqual([{ questionId: q1, answer: 'ب' }]);
    });
  });

  it('shows a teacher her own exams and her subjects\', not another subject\'s by id', async () => {
    const quiz: any = await asSchool(() => exams.create(paper('quiz', [String(classA)]), teacher(teacherA)));
    const id = String(quiz._id ?? quiz.id);

    await asSchool(() => exams.findOne(id, teacher(teacherB))); // teaches the subject in section B
    await expect(asSchool(() => exams.findOne(id, teacher(new Types.ObjectId()))))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('says on the student\'s grades whether a 0 is a mark, a miss, or not held yet', async () => {
    const quiz1 = await legacyExam('quiz', classA, teacherA, 10);
    await result(quiz1, studentA, 0);
    await m.Exam.collection.insertOne({
      gradesCriteriaId: criteriaId, subjectOfferingId: offeringId, classIds: [classA], examType: 'quiz',
      grade: 10, createdBy: teacherA, startDate: new Date(), endDate: new Date(Date.now() + 86400000),
      duration: 30, questions: [], schoolId, createdAt: new Date(), updatedAt: new Date(),
    });
    await legacyExam('assignment', classA, teacherA, 20); // closed, never sat

    const { data }: any = await asSchool(() => grades.getMyGrades(String(studentA), String(offeringId)));

    expect(data.grades.quizzes.map((q: any) => q.status)).toEqual(['graded', 'upcoming']);
    expect(data.grades.assignments[0].status).toBe('missed');
    expect(data.grades.final.status).toBe('not_set');
    expect(data.grades.quizzes[1].grade).toBe(0); // still a number for the clients
  });

  describe('projects', () => {
    let projects: ProjectsService;
    const studentModel = { findById: async (id: any) => ({ _id: id }) };

    const project = async (classIds: Types.ObjectId[], dueInDays = 3) =>
      (await m.Project.collection.insertOne({
        gradesCriteriaId: criteriaId, subjectOfferingId: offeringId, classIds, grade: 10,
        title: 'مشروع', description: '', dueDate: new Date(Date.now() + dueInDays * 86400000),
        createdBy: teacherA, files: [], schoolId,
      })).insertedId;
    const submission = (projectId: Types.ObjectId, studentId: Types.ObjectId, extra: any = {}) =>
      m.ProjectSubmission.collection.insertOne({ projectId, studentId, files: [], maxGrade: 10, schoolId, ...extra });

    beforeAll(() => {
      projects = new ProjectsService(
        m.Project, m.ProjectSubmission, m.GradesCriteria, m.Lecture, studentModel as any,
        {} as any, m.SubjectOffering, resolver as any,
      );
    });

    it('takes a submission only from a student of the project\'s classes', async () => {
      const id = String(await project([classA]));
      const files = [{ filename: 'x.pdf', path: '/nonexistent', originalname: 'x.pdf', size: 1 }] as any;

      await expect(asSchool(() => projects.submitFiles(id, student(studentB), files, {})))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(asSchool(() => projects.submitFiles(id, teacher(teacherA), files, {})))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('freezes a submission once it is marked', async () => {
      const pid = await project([classA]);
      await submission(pid, studentA, { files: [{ filename: 'x.pdf', path: '/nonexistent' }], achievedGrade: 8 });

      await expect(asSchool(() => projects.deleteSubmissionFile(String(pid), student(studentA), 'x.pdf')))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets a teacher mark only her own section\'s students', async () => {
      const pid = await project([classA, classB]);
      await submission(pid, studentB);

      await expect(asSchool(() => projects.gradeSubmission(String(pid), String(studentB), 7, teacher(teacherA))))
        .rejects.toBeInstanceOf(ForbiddenException);
      const ok: any = await asSchool(() => projects.gradeSubmission(String(pid), String(studentB), 7, teacher(teacherB)));
      expect(ok.data.achievedGrade).toBe(7);
    });

    it('will not delete a project students have handed in', async () => {
      const pid = await project([classA]);
      await submission(pid, studentA);

      await expect(asSchool(() => projects.delete(String(pid), teacher(teacherA))))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(await m.Project.collection.countDocuments({})).toBe(1);
    });
  });
});
