import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamResult, ExamResultSchema } from './schemas/exam-result.schema';
import { ExamsService } from './exams.service';
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
      {} as any, m.SubjectOffering, resolver as any,
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
});
