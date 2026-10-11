import { BadRequestException } from '@nestjs/common';
import { Connection, Types } from 'mongoose';

/**
 * The school's current academic year and term, from real relations.
 *
 * Several services each looked for `Term.findOne({ status: 'active' })` and,
 * finding none, applied no filter at all — so a school whose terms were all
 * still «upcoming» got every lecture, class and exam of every year mixed
 * together: last year's م1/أ next to this year's G9 in a teacher's timetable.
 *
 * Resolution, all within the school (the tenant plugin scopes both models):
 *  1. the year whose status is 'active';
 *  2. its terms — never matched by name, which repeats across years;
 *  3. the current term among them: one marked active, else the one today
 *     falls in, else the most recent to have started, else the next to start.
 *
 * `termIds` is the year's terms, for year-wide lists. It is `null` only for a
 * school with no active year at all, where the old behaviour (the active term
 * if any, else unscoped) is kept rather than emptying every screen.
 */
export interface CurrentScope {
  yearId: Types.ObjectId | null;
  termId: Types.ObjectId | null;
  termIds: Types.ObjectId[] | null;
}

export function pickCurrentTerm(terms: any[], now = new Date()): any | null {
  if (!terms.length) return null;
  const t = now.getTime();
  const start = (x: any) => (x.startDate ? new Date(x.startDate).getTime() : NaN);
  const end = (x: any) => (x.endDate ? new Date(x.endDate).getTime() : NaN);
  return (
    terms.find((x) => x.status === 'active') ??
    terms.find((x) => start(x) <= t && t <= end(x)) ??
    [...terms].filter((x) => start(x) <= t).sort((a, b) => start(b) - start(a))[0] ??
    [...terms].sort((a, b) => (start(a) || 0) - (start(b) || 0) || (a.order ?? 0) - (b.order ?? 0))[0]
  );
}

export async function currentScope(conn: Connection, now = new Date()): Promise<CurrentScope> {
  const Year = conn?.models?.['AcademicYear'];
  const Term = conn?.models?.['Term'];
  if (!Term) return { yearId: null, termId: null, termIds: null };

  const year: any = Year ? await Year.findOne({ status: 'active' }).select('_id').lean().exec() : null;
  if (!year) {
    const active: any = await Term.findOne({ status: 'active' }).select('_id').lean().exec();
    return { yearId: null, termId: active?._id ?? null, termIds: active ? [active._id] : null };
  }
  const terms: any[] = await Term.find({ academicYearId: year._id })
    .select('_id status startDate endDate order')
    .lean()
    .exec();
  const current = pickCurrentTerm(terms, now);
  return { yearId: year._id, termId: current?._id ?? null, termIds: terms.map((x) => x._id) };
}

/** A filter on `termId` for the current term: none at all only when the school has no year. */
export function currentTermFilter(scope: CurrentScope): Record<string, any> {
  if (scope.termId) return { termId: scope.termId };
  if (scope.termIds) return { termId: { $in: scope.termIds } }; // a year with no terms: nothing
  return {};
}

/** A filter on `termId` for the whole current year. */
export function yearTermFilter(scope: CurrentScope): Record<string, any> {
  return scope.termIds ? { termId: { $in: scope.termIds } } : {};
}

/**
 * The terms of a year the caller asked for by id. The tenant plugin keeps it
 * to the caller's school; another school's year simply has no terms here.
 */
export async function termIdsOfYear(conn: Connection, academicYearId: string): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(academicYearId)) {
    throw new BadRequestException('معرّف العام الدراسي غير صالح');
  }
  const Year = conn.models['AcademicYear'];
  const Term = conn.models['Term'];
  if (Year && !(await Year.exists({ _id: new Types.ObjectId(academicYearId) }))) {
    throw new BadRequestException('العام الدراسي غير موجود في هذه المدرسة');
  }
  const terms: any[] = await Term.find({ academicYearId: new Types.ObjectId(academicYearId) }).select('_id').lean().exec();
  return terms.map((x) => x._id);
}

/** The subject offerings of the given terms: for lists keyed by offering (exams, projects, subjects). */
export async function offeringIdsOfTermIds(conn: Connection, termIds: Types.ObjectId[]): Promise<Types.ObjectId[]> {
  const Offering = conn.models['SubjectOffering'];
  if (!Offering) return [];
  return Offering.distinct('_id', { termId: { $in: termIds } });
}

/**
 * The offerings a teacher-facing list is limited to when it names none: a
 * named year's, else the current year's. `null` — no limit (a school with no
 * active year).
 */
export async function scopedOfferingIds(
  conn: Connection,
  academicYearId?: string,
): Promise<Types.ObjectId[] | null> {
  if (academicYearId) return offeringIdsOfTermIds(conn, await termIdsOfYear(conn, academicYearId));
  const scope = await currentScope(conn);
  return scope.termIds ? offeringIdsOfTermIds(conn, scope.termIds) : null;
}
