/**
 * The Ministry grading template (نظام الوزارة) — fixed, never configured.
 *
 * A school runs either the flexible system (each subject's split set in
 * «معايير الدرجات») or this one. Here every subject is continuous or
 * final-exam, and each part's weight is set below, not by the school.
 * See grading-templates-overview.md.
 */
export const GRADING_SYSTEMS = ['flexible', 'ministry'] as const;
export type GradingSystem = (typeof GRADING_SYSTEMS)[number];

export const ASSESSMENT_TYPES = ['continuous', 'final_exam'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/** Marks per part, out of 100. */
export const MINISTRY_PARTS: Record<AssessmentType, { performance: number; written: number; final: number }> = {
  // التقويم المستمر (التكويني): المهام الأدائية والمشاركة والتفاعل 40، تقويمات تحريرية وأدوات تقويم متنوعة 60
  continuous: { performance: 40, written: 60, final: 0 },
  // التقويم الختامي: المهام الأدائية والمشاركة والتفاعل 40، تقويمات تحريرية 20، اختبار نهاية الفترة 40
  final_exam: { performance: 40, written: 20, final: 40 },
};

/**
 * How the 40 for performance, participation and interaction divides.
 *
 * Participation and homework come from the daily tracking ticks; tasks are
 * the graded electronic assignments, activities and projects (المهام
 * الأدائية). With no task set for the class all term, its share goes to the
 * other two rather than reading as a zero nobody earned.
 */
export const PERFORMANCE_SPLIT = {
  withTasks: { participation: 15, homework: 15, tasks: 10 },
  withoutTasks: { participation: 20, homework: 20, tasks: 0 },
} as const;

/** Electronic exams by register part. A final counts only on a final-exam subject. */
export const EXAM_PART: Record<string, 'written' | 'tasks' | 'final'> = {
  quiz: 'written',
  assignment: 'tasks',
  activity: 'tasks',
  final: 'final',
};

/** The default out-of for an exam or project set under this template. */
export const DEFAULT_EXAM_GRADE = { final: 40, other: 10 };

/** The assessment type that applies: the offering's override, else the subject's. */
export function resolveAssessmentType(offering: any): AssessmentType | null {
  const own = offering?.assessmentType;
  if (own) return own;
  const subject = offering?.subjectId;
  return (subject && typeof subject === 'object' && subject.assessmentType) || null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * التقدير — the ministry's verbal grade for a total out of 100.
 *
 * The bands above «مقبول» are fixed. The pass line is the subject's own
 * passingGrade when the school set one, else 50: a school that raised its pass
 * mark to 60 must not see a 55 called «مقبول».
 */
export type RatingKey = 'excellent' | 'very_good' | 'good' | 'acceptable' | 'failed';
export const DEFAULT_PASSING_GRADE = 50;
export const RATING_LABELS: Record<RatingKey, string> = {
  excellent: 'ممتاز',
  very_good: 'جيد جدًا',
  good: 'جيد',
  acceptable: 'مقبول',
  failed: 'غير مجتاز',
};

export function ratingOf(total: number | null | undefined, passingGrade?: number | null): { key: RatingKey; label: string } | null {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  const pass = typeof passingGrade === 'number' && passingGrade > 0 ? passingGrade : DEFAULT_PASSING_GRADE;
  const key: RatingKey =
    total < pass ? 'failed'
    : total >= 90 ? 'excellent'
    : total >= 80 ? 'very_good'
    : total >= 70 ? 'good'
    : 'acceptable';
  return { key, label: RATING_LABELS[key] };
}
