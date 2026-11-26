import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamResult, ExamResultSchema } from './schemas/exam-result.schema';
import { ExamsService } from './exams.service';
import { AnswerDto } from './dto/submit-answers.dto';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { effectiveMarks, markPaper, normalizeQuestion, scorePaper } from './question-rules.util';

/**
 * Question types: multiple choice, true/false and essay.
 *
 * Ms. Noura's maths quiz out of 20: five multiple-choice questions at 2
 * marks, three true/false at 1, one essay at 7. The automatic parts are
 * marked on submit; a paper with an essay answered waits for her, with no
 * grade at all, until she marks it.
 */

describe('question rules: pure', () => {
  it('forces true/false options and checks its answer', () => {
    expect(normalizeQuestion({ type: 'true_false', question: 'س', options: ['x', 'y', 'z'], correctAnswer: 'صح' }))
      .toMatchObject({ options: ['صح', 'خطأ'], correctAnswer: 'صح' });
    expect(() => normalizeQuestion({ type: 'true_false', question: 'س', correctAnswer: 'نعم' }))
      .toThrow('سؤال الصح والخطأ يجب أن تكون إجابته "صح" أو "خطأ"');
  });

  it('an essay has no options and no answer key', () => {
    expect(() => normalizeQuestion({ type: 'essay', question: 'س', options: ['أ', 'ب'] }))
      .toThrow('سؤال المقالي لا يحتوي على خيارات');
    expect(() => normalizeQuestion({ type: 'essay', question: 'س', correctAnswer: 'أ' })).toThrow(BadRequestException);
    expect(normalizeQuestion({ type: 'essay', question: 'س', modelAnswer: 'ن', marks: 7 }))
      .toMatchObject({ options: [], correctAnswer: null, modelAnswer: 'ن', marks: 7 });
  });

  it('multiple choice: two distinct, non-empty options, the answer among them, no model answer', () => {
    expect(() => normalizeQuestion({ question: 'س', options: ['أ'], correctAnswer: 'أ' })).toThrow(BadRequestException);
    expect(() => normalizeQuestion({ question: 'س', options: ['أ', 'أ'], correctAnswer: 'أ' })).toThrow(BadRequestException);
    expect(() => normalizeQuestion({ question: 'س', options: ['أ', ' '], correctAnswer: 'أ' })).toThrow(BadRequestException);
    expect(() => normalizeQuestion({ question: 'س', options: ['أ', 'ب'], correctAnswer: 'ج' })).toThrow(BadRequestException);
    expect(() => normalizeQuestion({ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ', modelAnswer: 'x' }))
      .toThrow(BadRequestException);
    expect(normalizeQuestion({ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' })).toMatchObject({ type: 'mcq', marks: null });
  });

  it('marks are multiples of 0.25, at least 0.25', () => {
    for (const marks of [0.3, 0, -1, 0.1]) {
      expect(() => normalizeQuestion({ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ', marks })).toThrow(BadRequestException);
    }
    expect(normalizeQuestion({ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ', marks: 1.75 }).marks).toBe(1.75);
  });

  it('4. scales Σmarks to the exam grade', () => {
    const exam = {
      grade: 20,
      questions: [
        { _id: 'a', question: 'س', options: ['1', '2'], correctAnswer: '1', marks: 5 },
        { _id: 'b', question: 'س', options: ['1', '2'], correctAnswer: '1', marks: 5 },
      ],
    };
    const fail = (): never => { throw new Error('unknown'); };
    expect(markPaper(exam, [{ questionId: 'a', answer: '1' }, { questionId: 'b', answer: '1' }], true, fail).achievedGrade).toBe(20);
    expect(markPaper(exam, [{ questionId: 'a', answer: '1' }], true, fail)).toMatchObject({ achievedGrade: 10, percentage: 50, passed: true });
  });

  it('3. an old exam scores exactly as the old formula did', () => {
    const old = { grade: 10, questions: [1, 2, 3].map((n) => ({ _id: `q${n}`, question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' })) };
    const fail = (): never => { throw new Error('unknown'); };
    for (let correct = 0; correct <= 3; correct++) {
      const answers = old.questions.map((q, i) => ({ questionId: q._id, answer: i < correct ? 'أ' : 'ب' }));
      const marked = markPaper(old, answers, true, fail);
      const pct = (correct / 3) * 100;
      expect(marked.achievedGrade).toBe(parseFloat(((pct / 100) * old.grade).toFixed(2)));
      expect(marked.percentage).toBe(parseFloat(pct.toFixed(2)));
      expect(marked.passed).toBe(pct >= 50);
    }
    expect(effectiveMarks(old)).toEqual([10 / 3, 10 / 3, 10 / 3]);
  });

  it('a paper with an unmarked essay has no grade at all', () => {
    expect(scorePaper([{ earned: 3, marks: 3 }, { earned: null, marks: 7 }], 20, false))
      .toEqual({ status: 'pending_review', achievedGrade: null, percentage: null, passed: null });
  });

  it('an essay answer may be long, up to 5000', async () => {
    const ok = await validate(plainToInstance(AnswerDto, { questionId: String(new Types.ObjectId()), answer: 'ا'.repeat(5000) }));
    const tooLong = await validate(plainToInstance(AnswerDto, { questionId: String(new Types.ObjectId()), answer: 'ا'.repeat(5001) }));
    expect(ok).toHaveLength(0);
    expect(tooLong.map((e) => e.property)).toEqual(['answer']);
  });
});

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-exam-question-types${query}`,
);

describe('question types: from the database', () => {
  let moduleRef: TestingModule;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const offeringId = new Types.ObjectId();
  const classA = new Types.ObjectId();
  const classB = new Types.ObjectId();
  const noura = new Types.ObjectId(); // teaches class A
  const huda = new Types.ObjectId(); // teaches the same subject to class B
  const reem = new Types.ObjectId();
  const sara = new Types.ObjectId();
  const lama = new Types.ObjectId(); // class B

  const classOf: Record<string, string[]> = {
    [String(reem)]: [String(classA)],
    [String(sara)]: [String(classA)],
    [String(lama)]: [String(classB)],
  };
  const resolver = { resolveClassIds: async (id: any) => classOf[String(id)] ?? [] };
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const teacher = (id: Types.ObjectId) => ({ role: 'TEACHER', userId: String(id) });
  const student = (id: Types.ObjectId) => ({ role: 'STUDENT', userId: String(id) });
  const owner = { role: 'OWNER', userId: String(new Types.ObjectId()) };

  let notify: jest.Mock;
  let service: ExamsService;

  const QUIZ = [
    ...[1, 2, 3, 4, 5].map((n) => ({ type: 'mcq', question: `اختيار ${n}`, options: ['1', '2', '3', '4'], correctAnswer: '2', marks: 2 })),
    ...[6, 7, 8].map((n) => ({ type: 'true_false', question: `صح أو خطأ ${n}`, options: ['ignored'], correctAnswer: 'صح', marks: 1 })),
    { type: 'essay', question: 'اشرح طريقة الحل', modelAnswer: 'نضرب ثم نجمع، والوحدة سم', marks: 7 },
  ];

  const createQuiz = (questions: any[] = QUIZ, by = noura) =>
    asSchool(() =>
      service.create(
        {
          subjectOfferingId: String(offeringId),
          classIds: [String(classA)],
          examType: 'quiz' as any,
          startDate: new Date(Date.now() - 3600_000),
          endDate: new Date(Date.now() + 86400_000),
          duration: 30,
          questions: questions as any,
        },
        teacher(by),
      ),
    );

  /** Answers to the quiz: mcq right count, tf right count, essay text. */
  const answersFor = (exam: any, mcqRight: number, tfRight: number, essay: string) =>
    exam.questions.map((q: any, i: number) => {
      if (q.type === 'essay') return { questionId: String(q._id), answer: essay };
      if (q.type === 'mcq') return { questionId: String(q._id), answer: i < mcqRight ? '2' : '3' };
      return { questionId: String(q._id), answer: i - 5 < tfRight ? 'صح' : 'خطأ' };
    });

  const sit = async (examId: any, who: Types.ObjectId, answers: any[]) =>
    asSchool(async () => {
      await service.startExam(String(examId), student(who));
      return service.gradeExam(String(examId), { answers } as any, student(who));
    });

  const resultOf = (examId: any, who: Types.ObjectId) =>
    m.ExamResult.findOne({ examId: new Types.ObjectId(String(examId)), studentId: who }).lean().exec();

  const essayId = (exam: any) => String(exam.questions.find((q: any) => q.type === 'essay')._id);
  const gradedNotices = () => notify.mock.calls.map((c) => c[0]).filter((n) => n.type === 'exam_graded');

  beforeAll(async () => {
    const models = [
      [Exam.name, ExamSchema], [ExamResult.name, ExamResultSchema],
      [GradesCriteria.name, GradesCriteriaSchema], [Class.name, ClassSchema],
      [Lecture.name, LectureSchema], [SubjectOffering.name, SubjectOfferingSchema],
      [Term.name, TermSchema], [Subject.name, SubjectSchema], [Teacher.name, TeacherSchema],
      [GradeLevel.name, GradeLevelSchema], [AcademicYear.name, AcademicYearSchema],
      [Student.name, StudentSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    for (const [name] of models) m[name] = moduleRef.get(getModelToken(name));
    await m.ExamResult.init();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    notify = jest.fn().mockResolvedValue(undefined);
    service = new ExamsService(
      m.Exam, m.GradesCriteria, m.Class, m.Lecture, m.Student, m.ExamResult,
      {} as any, m.SubjectOffering, resolver as any, m.AcademicYear, { notify } as any,
    );

    await m.AcademicYear.collection.insertOne({ _id: yearId, name: '2026', status: 'active', schoolId });
    await m.Term.collection.insertOne({
      _id: termId, academicYearId: yearId, name: 'الأول', order: 1,
      startDate: new Date('2026-08-30'), endDate: new Date('2027-01-10'), status: 'active', schoolId,
    });
    await m.Subject.collection.insertOne({ _id: subjectId, subjectName: 'رياضيات', schoolId });
    await m.SubjectOffering.collection.insertOne({ _id: offeringId, subjectId, gradeLevelId: gradeId, termId, schoolId });
    for (const [_id, name] of [[classA, 'أولى/أ'], [classB, 'أولى/ب']] as const) {
      await m.Class.collection.insertOne({
        _id, name, gradeLevelId: gradeId, academicYearId: yearId, gender: 'female', maxCapacity: 30, isActive: true, schoolId,
      });
    }
    await m.Student.collection.insertMany([
      { _id: reem, name: 'ريم', email: 'reem@t.t', classId: classA, isActive: true, schoolId },
      { _id: sara, name: 'سارة', email: 'sara@t.t', classId: classA, isActive: true, schoolId },
      { _id: lama, name: 'لمى', email: 'lama@t.t', classId: classB, isActive: true, schoolId },
    ]);
    await m.Lecture.collection.insertMany([
      { teacherId: noura, subjectOfferingId: offeringId, classId: classA, schoolId },
      { teacherId: huda, subjectOfferingId: offeringId, classId: classB, schoolId },
    ]);
    // Out of 20: quizzes weigh 100 over 5 quizzes.
    await m.GradesCriteria.collection.insertOne({
      subjectOfferingId: offeringId, final: 0, assignments: 0, assignmentsCount: 0,
      activities: 0, projects: 0, projectsCount: 0, quizzes: 100, quizzesCount: 5, schoolId,
    });
  });

  // ─────────────────────────────────────────── 1. the scenario

  it('1. Reem waits for the essay and ends 18/20; Sara is 11/20 at once; one notice, to Reem', async () => {
    const exam: any = await createQuiz();
    expect(exam.grade).toBe(20);
    expect(exam.questions.map((q: any) => q.type)).toEqual([...Array(5).fill('mcq'), ...Array(3).fill('true_false'), 'essay']);

    // Reem: 1–8 all right, an answer to 9.
    const reemSubmit: any = await sit(exam._id, reem, answersFor(exam, 5, 3, 'نضرب ثم نجمع'));
    expect(reemSubmit).toMatchObject({
      status: 'pending_review', achievedGrade: null, percentage: null, passed: null, results: [],
      message: 'تم التسليم، وستظهر النتيجة بعد تصحيح المعلمة',
    });
    expect(await resultOf(exam._id, reem)).toMatchObject({ status: 'pending_review', achievedGrade: null });

    // Sara: 4 + 3 right, 9 blank — graded straight away.
    const saraSubmit: any = await sit(exam._id, sara, answersFor(exam, 4, 3, '   '));
    expect(saraSubmit).toMatchObject({ status: 'graded', achievedGrade: 11, percentage: 55, passed: true });
    expect(saraSubmit.results.find((r: any) => r.type === 'essay')).toMatchObject({ earned: 0, marks: 7, modelAnswer: 'نضرب ثم نجمع، والوحدة سم' });

    // Ms. Noura's review: one pending answer, Reem's, beside the model answer.
    const review: any = await asSchool(() => service.getReview(String(exam._id), undefined, teacher(noura)));
    expect(review.data).toMatchObject({ grade: 20, totalMarks: 20, pendingCount: 1 });
    expect(review.data.questions).toHaveLength(1);
    expect(review.data.questions[0]).toMatchObject({ marks: 7, modelAnswer: 'نضرب ثم نجمع، والوحدة سم' });
    expect(review.data.questions[0].answers).toEqual([
      expect.objectContaining({ studentId: String(reem), studentName: 'ريم', className: 'أولى/أ', answer: 'نضرب ثم نجمع', earned: null }),
    ]);

    const saved: any = await asSchool(() =>
      service.reviewAnswers(String(exam._id), {
        grades: [{ studentId: String(reem), questionId: essayId(exam), earned: 5, feedback: 'أحسنتِ، ينقص ذكر الوحدة' }],
      }, teacher(noura)),
    );
    expect(saved.data).toEqual({ updated: 1, gradedNow: [String(reem)], pendingCount: 0 });
    expect(await resultOf(exam._id, reem)).toMatchObject({ status: 'graded', achievedGrade: 18, percentage: 90, passed: true });

    expect(gradedNotices()).toHaveLength(1);
    expect(gradedNotices()[0]).toMatchObject({
      recipientId: String(reem),
      title: 'تم تصحيح اختبار',
      body: 'صُحِّح اختبار رياضيات، ودرجتك 18 من 20.',
      data: { examId: String(exam._id), subjectName: 'رياضيات', achievedGrade: 18, grade: 20 },
    });

    // Re-marking recomputes, and does not notify again.
    const again: any = await asSchool(() =>
      service.reviewAnswers(String(exam._id), { grades: [{ studentId: String(reem), questionId: essayId(exam), earned: 6.5 }] }, teacher(noura)),
    );
    expect(again.data.gradedNow).toEqual([]);
    expect(await resultOf(exam._id, reem)).toMatchObject({ achievedGrade: 19.5 });
    expect(gradedNotices()).toHaveLength(1);
    // Her feedback from the first save is kept when the second sends none.
    const reemRow: any = await resultOf(exam._id, reem);
    expect(reemRow.answers.find((a: any) => a.type === 'essay')).toMatchObject({
      earned: 6.5, feedback: 'أحسنتِ، ينقص ذكر الوحدة', gradedBy: noura,
    });
  });

  // ─────────────────────────────────────────── 2. create validation

  describe('2. creating', () => {
    it('forces true/false options to صح/خطأ', async () => {
      const exam: any = await createQuiz();
      const tf = exam.questions.find((q: any) => q.type === 'true_false');
      expect(tf.options).toEqual(['صح', 'خطأ']);
      const stored: any = await m.Exam.collection.findOne({ _id: exam._id });
      expect(stored.questions[5].options).toEqual(['صح', 'خطأ']);
    });

    it('refuses an essay with options, mixed marks, and 0.3', async () => {
      await expect(createQuiz([{ type: 'essay', question: 'س', options: ['أ', 'ب'] }])).rejects.toThrow('سؤال المقالي لا يحتوي على خيارات');
      await expect(createQuiz([
        { question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ', marks: 2 },
        { question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' },
      ])).rejects.toThrow('حدّد درجة كل سؤال، أو اترك الدرجات فارغة لتوزيعها بالتساوي');
      await expect(createQuiz([{ question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ', marks: 0.3 }])).rejects.toThrow(BadRequestException);
      expect(await m.Exam.countDocuments({})).toBe(0);
    });

    it('adding or editing a question keeps the same rules', async () => {
      const exam: any = await createQuiz();
      // Unmarked question on a marked exam: mixed.
      await expect(asSchool(() =>
        service.addQuestion(String(exam._id), { question: 'س', options: ['أ', 'ب'], correctAnswer: 'أ' } as any, teacher(noura)),
      )).rejects.toThrow('حدّد درجة كل سؤال');
      const added: any = await asSchool(() =>
        service.addQuestion(String(exam._id), { type: 'true_false', question: 'س', correctAnswer: 'خطأ', marks: 1 } as any, teacher(noura)),
      );
      expect(added.questions.at(-1)).toMatchObject({ type: 'true_false', options: ['صح', 'خطأ'], marks: 1 });

      // An mcq turned into an essay drops its options and key.
      const first = String(exam.questions[0]._id);
      const edited: any = await asSchool(() =>
        service.updateQuestion(String(exam._id), first, { type: 'essay', modelAnswer: 'ن' }, teacher(noura)),
      );
      expect(edited.questions[0]).toMatchObject({ type: 'essay', options: [], correctAnswer: null, modelAnswer: 'ن', marks: 2 });
      await expect(asSchool(() =>
        service.updateQuestion(String(exam._id), first, { marks: null }, teacher(noura)),
      )).rejects.toThrow('حدّد درجة كل سؤال');
      await expect(asSchool(() =>
        service.updateQuestion(String(exam._id), String(exam.questions[5]._id), { correctAnswer: 'ربما' }, teacher(noura)),
      )).rejects.toThrow('سؤال الصح والخطأ');
    });
  });

  // ─────────────────────────────────────────── 3. old exams

  it('3. an old exam (no type, no marks) marks as before and reads as mcq with an equal share', async () => {
    const examId = (await m.Exam.collection.insertOne({
      subjectOfferingId: offeringId, classIds: [classA], examType: 'quiz', grade: 10, createdBy: noura,
      startDate: new Date(Date.now() - 3600_000), endDate: new Date(Date.now() + 86400_000), duration: 30, schoolId,
      questions: [1, 2, 3].map((n) => ({ _id: new Types.ObjectId(), question: `س${n}`, options: ['أ', 'ب'], correctAnswer: 'أ' })),
    })).insertedId;

    const read: any = await asSchool(() => service.findOne(String(examId), teacher(noura)));
    expect(read.questions.map((q: any) => [q.type, q.marks])).toEqual([['mcq', 3.33], ['mcq', 3.33], ['mcq', 3.33]]);

    const q = read.questions;
    const res: any = await sit(examId, reem, [{ questionId: String(q[0]._id), answer: 'أ' }]);
    expect(res).toMatchObject({ status: 'graded', achievedGrade: 3.33, percentage: 33.33, passed: false, correctAnswers: 1 });
    expect(res.answeredQuestions).toBe(1);
  });

  // ─────────────────────────────────────────── 5. review rules

  describe('5. review', () => {
    let exam: any;
    beforeEach(async () => {
      exam = await createQuiz();
      await sit(exam._id, reem, answersFor(exam, 5, 3, 'جواب'));
    });

    it('refuses earned above the marks, off the 0.25 step, or on a non-essay question', async () => {
      const send = (grades: any[]) => asSchool(() => service.reviewAnswers(String(exam._id), { grades }, teacher(noura)));
      await expect(send([{ studentId: String(reem), questionId: essayId(exam), earned: 7.25 }])).rejects.toThrow(BadRequestException);
      await expect(send([{ studentId: String(reem), questionId: essayId(exam), earned: 5.3 }])).rejects.toThrow(BadRequestException);
      await expect(send([{ studentId: String(reem), questionId: essayId(exam), earned: -1 }])).rejects.toThrow(BadRequestException);
      await expect(send([{ studentId: String(reem), questionId: String(exam.questions[0]._id), earned: 1 }])).rejects.toThrow('للأسئلة المقالية فقط');
      await expect(send([{ studentId: String(sara), questionId: essayId(exam), earned: 1 }])).rejects.toThrow(BadRequestException);
      // Nothing was written by any of them.
      expect(await resultOf(exam._id, reem)).toMatchObject({ status: 'pending_review' });
    });

    it('another class\'s teacher gets 403, and sees none of these answers', async () => {
      await expect(asSchool(() =>
        service.reviewAnswers(String(exam._id), { grades: [{ studentId: String(reem), questionId: essayId(exam), earned: 5 }] }, teacher(huda)),
      )).rejects.toBeInstanceOf(ForbiddenException);
      const hers: any = await asSchool(() => service.getReview(String(exam._id), 'all', teacher(huda)));
      expect(hers.data.pendingCount).toBe(0);
      expect(hers.data.questions[0].answers).toEqual([]);
      // A student is not a marker.
      await expect(asSchool(() => service.getReview(String(exam._id), undefined, student(reem)))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the owner may mark', async () => {
      const done: any = await asSchool(() =>
        service.reviewAnswers(String(exam._id), { grades: [{ studentId: String(reem), questionId: essayId(exam), earned: 7 }] }, owner),
      );
      expect(done.data.gradedNow).toEqual([String(reem)]);
      expect(await resultOf(exam._id, reem)).toMatchObject({ achievedGrade: 20 });
    });

    it('the whole-paper override grades a pending paper, leaving the essay unmarked', async () => {
      await asSchool(() => service.editStudentGrade(String(exam._id), String(reem), 15, teacher(noura)));
      const row: any = await resultOf(exam._id, reem);
      expect(row).toMatchObject({ status: 'graded', achievedGrade: 15 });
      expect(row.answers.find((a: any) => a.type === 'essay').earned).toBeNull();
      expect(gradedNotices()).toHaveLength(1);
      // No longer waiting on anyone.
      const review: any = await asSchool(() => service.getReview(String(exam._id), undefined, teacher(noura)));
      expect(review.data.pendingCount).toBe(0);
    });

    it('lists show status and pending counts', async () => {
      await sit(exam._id, sara, answersFor(exam, 4, 3, ''));
      const results: any = await asSchool(() => service.listResults(String(exam._id), teacher(noura)));
      const row = (id: Types.ObjectId) => results.data.results.find((r: any) => String(r.studentId) === String(id));
      expect(row(reem)).toMatchObject({ status: 'pending_review', pendingCount: 1, achievedGrade: null });
      expect(row(sara)).toMatchObject({ status: 'graded', pendingCount: 0, achievedGrade: 11 });
      expect(results.data.pendingReviewCount).toBe(1);

      const mine: any = await asSchool(() => service.filtering({}, {}, teacher(noura)));
      expect(mine.find((e: any) => String(e._id) === String(exam._id)).pendingReviewCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────── 6. what the student sees

  it('6. a student never sees the answer key or the model answer before grading', async () => {
    const exam: any = await createQuiz();
    const leaks = (questions: any[]) =>
      questions.some((q) => 'correctAnswer' in q || 'modelAnswer' in q);

    const started: any = await asSchool(() => service.startExam(String(exam._id), student(reem)));
    expect(leaks(started.data.exam.questions)).toBe(false);
    expect(Object.keys(started.data.exam.questions[8]).sort()).toEqual(['_id', 'marks', 'options', 'question', 'type']);

    const list: any = await asSchool(() => service.getMyExams(String(reem)));
    expect(leaks(list.data[0].questions)).toBe(false);

    const byId: any = await asSchool(() => service.findOne(String(exam._id), student(reem)));
    expect(leaks(byId.questions)).toBe(false);

    await asSchool(() => service.gradeExam(String(exam._id), { answers: answersFor(exam, 5, 3, 'جواب') } as any, student(reem)));
    const pending: any = await asSchool(() => service.getMyResult(String(exam._id), student(reem)));
    expect(pending.data).toMatchObject({ status: 'pending_review', achievedGrade: null, results: [] });

    await asSchool(() =>
      service.reviewAnswers(String(exam._id), { grades: [{ studentId: String(reem), questionId: essayId(exam), earned: 5, feedback: 'ملاحظة' }] }, teacher(noura)),
    );
    const graded: any = await asSchool(() => service.getMyResult(String(exam._id), student(reem)));
    expect(graded.data).toMatchObject({ status: 'graded', achievedGrade: 18 });
    const essay = graded.data.results.find((r: any) => r.type === 'essay');
    expect(essay).toMatchObject({ earned: 5, marks: 7, feedback: 'ملاحظة', modelAnswer: 'نضرب ثم نجمع، والوحدة سم' });
    expect('correctAnswer' in essay).toBe(false);
    expect(graded.data.results[0]).toMatchObject({ type: 'mcq', correctAnswer: '2', earned: 2, marks: 2 });
  });

  // ─────────────────────────────────────────── 7. auto-submit

  it('7. the sweep leaves a paper with an essay draft pending; a blank essay draft is graded', async () => {
    const exam: any = await createQuiz();
    await asSchool(async () => {
      await service.startExam(String(exam._id), student(reem));
      await service.saveAnswers(String(exam._id), { answers: answersFor(exam, 5, 3, 'مسودة') } as any, student(reem));
      await service.startExam(String(exam._id), student(sara));
      await service.saveAnswers(String(exam._id), { answers: answersFor(exam, 5, 3, '') } as any, student(sara));
    });

    const closed = await service.sweepExpiredSessions(Date.now() + 2 * 86400_000);
    expect(closed).toBe(2);
    expect(await resultOf(exam._id, reem)).toMatchObject({ submitted: true, autoSubmitted: true, status: 'pending_review', achievedGrade: null });
    expect(await resultOf(exam._id, sara)).toMatchObject({ submitted: true, status: 'graded', achievedGrade: 13 });
  });
});
