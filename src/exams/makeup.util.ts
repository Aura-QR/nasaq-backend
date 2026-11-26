/**
 * How a makeup exam («اختبار بديل») counts: as the exam it stands in for.
 *
 * A makeup is never a column, a count or an item of its own. Its result is
 * the original's result for that student, and while a makeup set for her is
 * still open the original is "not held yet" for her — neither a mark nor a 0.
 *
 * Shared by the ministry register and the flexible term grade, so the two
 * templates read a makeup the same way.
 */
import { Model, Types } from 'mongoose';

/** The filter that keeps makeups out of exam lists and counts. */
export const ORIGINALS_ONLY = { makeupOf: null } as const;

export interface MakeupView {
  /** `${originalId}|${studentId}` → the makeup result for her (submitted or not). */
  resultOf: Map<string, any>;
  /** `${originalId}|${studentId}` → when the latest makeup set for her closes (ms). */
  closesAt: Map<string, number>;
}

export async function loadMakeupView(
  examModel: Model<any>,
  examResultModel: Model<any>,
  originalIds: any[],
  studentIds?: any[],
): Promise<MakeupView> {
  const view: MakeupView = { resultOf: new Map(), closesAt: new Map() };
  if (!originalIds.length) return view;

  const filter: any = { makeupOf: { $in: originalIds.map((id) => new Types.ObjectId(String(id))) } };
  if (studentIds?.length) {
    filter.studentIds = { $in: studentIds.map((id) => new Types.ObjectId(String(id))) };
  }
  const makeups: any[] = await examModel.find(filter).select('_id makeupOf endDate studentIds').lean().exec();
  if (!makeups.length) return view;

  const wanted = studentIds?.length ? new Set(studentIds.map(String)) : null;
  const makeupById = new Map(makeups.map((m) => [String(m._id), m]));
  for (const m of makeups) {
    for (const sid of (m.studentIds ?? []).map(String)) {
      if (wanted && !wanted.has(sid)) continue;
      const key = `${m.makeupOf}|${sid}`;
      const closes = new Date(m.endDate).getTime();
      view.closesAt.set(key, Math.max(view.closesAt.get(key) ?? 0, closes));
    }
  }

  const resultFilter: any = { examId: { $in: makeups.map((m) => m._id) } };
  if (studentIds?.length) resultFilter.studentId = { $in: studentIds.map((id) => new Types.ObjectId(String(id))) };
  const results: any[] = await examResultModel
    .find(resultFilter)
    .select('examId studentId achievedGrade status submitted')
    .lean()
    .exec();
  for (const r of results) {
    const m = makeupById.get(String(r.examId));
    if (!m) continue;
    // Only a student the makeup was set for.
    if (!(m.studentIds ?? []).some((s: any) => String(s) === String(r.studentId))) continue;
    const key = `${m.makeupOf}|${r.studentId}`;
    // A submitted paper wins over one still being sat.
    const prev = view.resultOf.get(key);
    if (!prev || (!prev.submitted && r.submitted)) view.resultOf.set(key, r);
  }
  return view;
}

/** Is the original still to be sat by her on a makeup (one set for her that has not closed)? */
export function makeupStillOpen(view: MakeupView, originalId: any, studentId: any, now = Date.now()): boolean {
  return (view.closesAt.get(`${originalId}|${studentId}`) ?? 0) >= now;
}
