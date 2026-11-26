/**
 * Question types, marks, and how a paper is scored.
 *
 * One place for the arithmetic, because four paths reach it — submit, the
 * auto-submit sweep, the teacher's essay review and the whole-paper override —
 * and a paper must come out the same whichever of them closes it.
 *
 * An exam written before question types existed has questions with no `type`
 * and no `marks`. They read as multiple choice sharing the exam's grade
 * equally, and score exactly as they always did: correct ÷ total × grade.
 */
import { BadRequestException } from '@nestjs/common';

export const QUESTION_TYPES = ['mcq', 'true_false', 'essay'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Stored on a true/false question so an app that only knows multiple choice shows it as two options. */
export const TRUE_FALSE_OPTIONS = ['صح', 'خطأ'];

export const MODEL_ANSWER_MAX = 2000;
export const ANSWER_MAX = 5000;
export const FEEDBACK_MAX = 1000;

/** Two decimals, rounded the way exam marks always were (toFixed). */
export function round2(value: number): number {
  return parseFloat(Number(value).toFixed(2));
}

/** A multiple of 0.25 (floating-point tolerant). */
export function isQuarter(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;
}

export function typeOf(q: any): QuestionType {
  return QUESTION_TYPES.includes(q?.type) ? q.type : 'mcq';
}

const blank = (v: any) => v === undefined || v === null;

/**
 * The stored shape of one question, or a 400 naming what is wrong with it.
 * `label` names the question in the message («السؤال 3»).
 */
export function normalizeQuestion(input: any, label = 'السؤال') {
  const type: QuestionType = blank(input?.type) ? 'mcq' : input.type;
  if (!QUESTION_TYPES.includes(type)) {
    throw new BadRequestException(`${label}: نوع السؤال يجب أن يكون اختيار من متعدد أو صح وخطأ أو مقالي`);
  }
  const question = typeof input?.question === 'string' ? input.question.trim() : '';
  if (!question) {
    throw new BadRequestException(`${label}: نص السؤال مطلوب`);
  }

  const marks = blank(input?.marks) ? null : Number(input.marks);
  if (marks !== null && (!(marks >= 0.25) || !isQuarter(marks))) {
    throw new BadRequestException(`${label}: درجة السؤال يجب أن تكون من مضاعفات 0.25، ولا تقل عن 0.25`);
  }

  const modelAnswer = blank(input?.modelAnswer) ? null : String(input.modelAnswer);
  const options: string[] = Array.isArray(input?.options) ? input.options : [];
  const correctAnswer = blank(input?.correctAnswer) ? null : String(input.correctAnswer);

  if (type === 'essay') {
    if (options.length > 0) {
      throw new BadRequestException(`${label}: سؤال المقالي لا يحتوي على خيارات`);
    }
    if (correctAnswer !== null) {
      throw new BadRequestException(`${label}: سؤال المقالي لا يحتوي على إجابة صحيحة؛ استخدم الإجابة النموذجية`);
    }
    if (modelAnswer !== null && modelAnswer.length > MODEL_ANSWER_MAX) {
      throw new BadRequestException(`${label}: الإجابة النموذجية لا تتجاوز ${MODEL_ANSWER_MAX} حرف`);
    }
    return { type, question, options: [], correctAnswer: null, modelAnswer, marks };
  }

  if (modelAnswer !== null) {
    throw new BadRequestException(`${label}: الإجابة النموذجية للأسئلة المقالية فقط`);
  }

  if (type === 'true_false') {
    // Whatever options the client sent are ignored: the two are fixed.
    const answer = correctAnswer?.trim() ?? '';
    if (!TRUE_FALSE_OPTIONS.includes(answer)) {
      throw new BadRequestException(`${label}: سؤال الصح والخطأ يجب أن تكون إجابته "صح" أو "خطأ"`);
    }
    return { type, question, options: [...TRUE_FALSE_OPTIONS], correctAnswer: answer, modelAnswer: null, marks };
  }

  // Multiple choice, as it has always been, plus clean options.
  if (options.length < 2) {
    throw new BadRequestException(`${label}: سؤال الاختيار من متعدد يحتاج خيارين على الأقل`);
  }
  if (options.some((o) => typeof o !== 'string' || !o.trim())) {
    throw new BadRequestException(`${label}: لا يمكن أن يكون أحد الخيارات فارغًا`);
  }
  if (new Set(options.map((o) => o.trim())).size !== options.length) {
    throw new BadRequestException(`${label}: الخيارات يجب أن تكون مختلفة`);
  }
  if (correctAnswer === null || !options.includes(correctAnswer)) {
    throw new BadRequestException(
      `الإجابة الصحيحة "${correctAnswer ?? ''}" يجب أن تكون إحدى الخيارات المتاحة في السؤال: "${question}"`,
    );
  }
  return { type, question, options, correctAnswer, modelAnswer: null, marks };
}

/** Every question has its own marks — else they all share the grade equally. */
export function allMarksSet(questions: any[]): boolean {
  return questions.length > 0 && questions.every((q) => typeof q?.marks === 'number');
}

/** Either every question has marks or none has: half and half has no meaning. */
export function assertMarksConsistent(questions: any[]): void {
  const set = questions.filter((q) => typeof q?.marks === 'number').length;
  if (set > 0 && set < questions.length) {
    throw new BadRequestException('حدّد درجة كل سؤال، أو اترك الدرجات فارغة لتوزيعها بالتساوي');
  }
}

/**
 * What each question is worth, in order. Its own marks when every question
 * has them; otherwise an equal share of the exam's grade. Never null.
 */
export function effectiveMarks(exam: { grade?: number; questions?: any[] }): number[] {
  const questions = exam?.questions ?? [];
  if (allMarksSet(questions)) return questions.map((q) => q.marks);
  const share = questions.length ? Number(exam?.grade ?? 0) / questions.length : 0;
  return questions.map(() => share);
}

/** One question as clients read it: always a `type`, always a numeric `marks`. */
export function presentQuestion(q: any, marks: number) {
  return { ...q, type: typeOf(q), marks: round2(marks), modelAnswer: q?.modelAnswer ?? null };
}

/** One question as a student taking the exam reads it: no answer key, no model answer. */
export function studentQuestion(q: any, marks: number) {
  return {
    _id: q._id,
    type: typeOf(q),
    question: q.question,
    options: q.options ?? [],
    marks: round2(marks),
  };
}

export interface MarkedAnswer {
  questionId: string;
  studentAnswer: string;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  type: QuestionType;
  marks: number;
  earned: number | null;
  feedback: string | null;
  gradedAt: Date | null;
  gradedBy: any;
}

/**
 * Score a paper from its answer entries. Any essay still unmarked
 * (`earned === null`) leaves the paper pending, with no grade at all — a
 * partial score reads as final when it is not.
 *
 * `equalShare` is true when the exam has no marks of its own: the ratio is
 * then counted per question, exactly as before (correct ÷ total).
 */
export function scorePaper(entries: Pick<MarkedAnswer, 'earned' | 'marks'>[], grade: number, equalShare: boolean) {
  if (entries.some((e) => e.earned === null || e.earned === undefined)) {
    return { status: 'pending_review' as const, achievedGrade: null, percentage: null, passed: null };
  }
  let ratio = 0;
  if (equalShare) {
    const n = entries.length || 1;
    ratio = entries.reduce((sum, e) => sum + (e.marks > 0 ? (e.earned as number) / e.marks : 0), 0) / n;
  } else {
    const total = entries.reduce((sum, e) => sum + e.marks, 0);
    ratio = total > 0 ? entries.reduce((sum, e) => sum + (e.earned as number), 0) / total : 0;
  }
  // Through the percentage, as the marking always went, so an old exam's
  // paper comes out to the same hundredth it always did.
  const percentage = ratio * 100;
  return {
    status: 'graded' as const,
    achievedGrade: round2((percentage / 100) * Number(grade)),
    percentage: round2(percentage),
    passed: percentage >= 50,
  };
}

/**
 * Mark a paper. Every question gets an entry; one never answered counts as
 * answered blank. One answer per question, the first one sent. `strict`
 * refuses an unknown question (a live submission); saved drafts skip it.
 */
export function markPaper(
  exam: { grade: number; questions: any[] },
  answers: { questionId: string; answer: string }[] | undefined,
  strict: boolean,
  onUnknown: (id: string) => never,
) {
  const questions = exam.questions ?? [];
  const marks = effectiveMarks(exam);
  const known = new Set(questions.map((q) => String(q._id)));

  const given = new Map<string, string>();
  for (const a of answers ?? []) {
    const id = String(a.questionId);
    if (!known.has(id)) {
      if (strict) onUnknown(id);
      continue;
    }
    if (!given.has(id)) given.set(id, String(a.answer ?? ''));
  }

  const results: MarkedAnswer[] = questions.map((q, i) => {
    const id = String(q._id);
    const type = typeOf(q);
    const studentAnswer = given.get(id) ?? '';
    const entry: MarkedAnswer = {
      questionId: id,
      studentAnswer,
      correctAnswer: null,
      isCorrect: null,
      type,
      marks: marks[i],
      earned: null,
      feedback: null,
      gradedAt: null,
      gradedBy: null,
    };
    if (type === 'essay') {
      // A blank essay is a 0 with nothing to read, so nothing waits on it.
      if (!studentAnswer.trim()) entry.earned = 0;
      return entry;
    }
    const correct = String(q.correctAnswer ?? '');
    entry.correctAnswer = correct;
    entry.isCorrect = studentAnswer.trim().toLowerCase() === correct.trim().toLowerCase();
    entry.earned = entry.isCorrect ? marks[i] : 0;
    return entry;
  });

  return {
    results,
    correct: results.filter((r) => r.isCorrect === true).length,
    ...scorePaper(results, exam.grade, !allMarksSet(questions)),
  };
}

/**
 * A graded paper's answers as the student reads them: her mark and the
 * teacher's note on each; the model answer for an essay; the correct answer
 * only where there is one. Old rows (no type, no marks) are filled in.
 */
export function presentAnswers(exam: { grade: number; questions: any[] }, answers: any[]) {
  const marks = effectiveMarks(exam);
  const byId = new Map((exam.questions ?? []).map((q, i) => [String(q._id), { q, marks: marks[i] }]));
  return (answers ?? []).map((raw: any) => {
    const a = typeof raw?.toObject === 'function' ? raw.toObject() : { ...raw };
    const known = byId.get(String(a.questionId));
    const type: QuestionType = a.type ?? (known ? typeOf(known.q) : 'mcq');
    const m = typeof a.marks === 'number' ? a.marks : known?.marks ?? 0;
    const earned = a.earned !== undefined ? a.earned : a.isCorrect ? m : 0;
    const out: any = {
      questionId: a.questionId,
      studentAnswer: a.studentAnswer ?? '',
      isCorrect: a.isCorrect ?? null,
      type,
      marks: round2(m),
      earned: earned === null ? null : round2(earned),
      feedback: a.feedback ?? null,
    };
    if (type === 'essay') out.modelAnswer = known?.q?.modelAnswer ?? null;
    else out.correctAnswer = a.correctAnswer ?? known?.q?.correctAnswer ?? null;
    return out;
  });
}
