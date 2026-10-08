import { ConflictException } from '@nestjs/common';
import { Connection, Types } from 'mongoose';

/**
 * Deleting a year, term, class or subject offering — what blocks it, and
 * what goes with it.
 *
 * Deletes used to remove the one row and leave everything that pointed at
 * it. A deleted year kept its subject offerings, timetable and teacher
 * assignments. The teacher's exam form still listed last year's subject, and
 * a final set on it went to last year's classes, where no student of this
 * year could see it.
 *
 * Two kinds of thing hang off the structure:
 *  - **Work**: marks, attendance, lesson plans, money. It is never deleted
 *    as a side effect. If any exists, the delete is refused and the message
 *    says what is there.
 *  - **Skeleton**: the timetable, teacher assignments, grade distributions
 *    with no exams yet, and teacher availability. It means nothing without
 *    its parent, so it goes with it.
 *
 * Raw collections, matched by id. Ids are unique across schools, so this
 * reaches only the rows of the thing being deleted, without the tenant
 * plugin.
 */
export interface StructureScope {
  yearId?: Types.ObjectId;
  termIds?: Types.ObjectId[];
  offeringIds?: Types.ObjectId[];
  classIds?: Types.ObjectId[];
}

const collection = (conn: Connection, model: string) => conn.models[model]?.collection ?? null;

/** Preparation.subject is Mixed: some rows hold the id as a string. */
const idsAndStrings = (ids: Types.ObjectId[]) => [...ids, ...ids.map(String)];

async function count(conn: Connection, model: string, filter: any): Promise<number> {
  const c = collection(conn, model);
  return c ? c.countDocuments(filter) : 0;
}

/** What blocks the delete, as Arabic phrases ready for the message. */
export async function workUnder(conn: Connection, scope: StructureScope): Promise<string[]> {
  const offerings = scope.offeringIds ?? [];
  const classes = scope.classIds ?? [];
  const checks: [string, string, any | null][] = [
    ['Exam', 'اختبار', offerings.length || classes.length
      ? { $or: [{ subjectOfferingId: { $in: offerings } }, { classIds: { $in: classes } }] } : null],
    ['Project', 'مشروع', offerings.length || classes.length
      ? { $or: [{ subjectOfferingId: { $in: offerings } }, { classIds: { $in: classes } }] } : null],
    ['Preparation', 'تحضير', offerings.length || classes.length
      ? { $or: [{ subject: { $in: idsAndStrings(offerings) } }, { classId: { $in: classes } }] } : null],
    ['Library', 'محتوى رقمي', offerings.length ? { subjectOfferingId: { $in: offerings } } : null],
    ['DailyTracking', 'سجل متابعة', offerings.length || classes.length
      ? { $or: [{ subjectOfferingId: { $in: offerings } }, { classId: { $in: classes } }] } : null],
    ['Attendance', 'سجل غياب', classes.length ? { classId: { $in: classes } } : null],
    ['Enrollment', 'تسجيل طالب', classes.length || scope.yearId
      ? { $or: [{ classId: { $in: classes } }, ...(scope.yearId ? [{ academicYearId: scope.yearId }] : [])] } : null],
    ['Student', 'طالب', classes.length ? { classId: { $in: classes } } : null],
    ['StudentFinancialRecord', 'سجل مالي', classes.length || scope.yearId
      ? { $or: [{ classId: { $in: classes } }, ...(scope.yearId ? [{ academicYearId: scope.yearId }] : [])] } : null],
    ['Expense', 'مصروف', scope.yearId ? { academicYearId: scope.yearId } : null],
  ];

  const found: string[] = [];
  for (const [model, label, filter] of checks) {
    if (!filter) continue;
    const n = await count(conn, model, filter);
    if (n) found.push(`${n} ${label}`);
  }
  return found;
}

export async function refuseIfWork(conn: Connection, scope: StructureScope, what: string): Promise<void> {
  const found = await workUnder(conn, scope);
  if (found.length) {
    throw new ConflictException(
      `لا يمكن حذف ${what}: يرتبط بها ${found.join('، ')}. احذفها أولًا، أو أرشف السنة بدلًا من حذفها.`,
    );
  }
}

/** The subject offerings of the given terms. */
export async function offeringIdsOfTerms(conn: Connection, termIds: Types.ObjectId[]): Promise<Types.ObjectId[]> {
  const c = collection(conn, 'SubjectOffering') ?? conn.collection('subjectofferings');
  if (!termIds.length) return [];
  const rows = await c.find({ termId: { $in: termIds } }, { projection: { _id: 1 } }).toArray();
  return rows.map((o: any) => o._id);
}

/** Remove the skeleton under the scope. Call only after refuseIfWork. */
export async function removeSkeleton(conn: Connection, scope: StructureScope): Promise<Record<string, number>> {
  const offerings = scope.offeringIds ?? [];
  const classes = scope.classIds ?? [];
  const terms = scope.termIds ?? [];
  const removed: Record<string, number> = {};
  const drop = async (model: string, filter: any | null) => {
    const c = collection(conn, model);
    if (!c || !filter) return;
    const { deletedCount } = await c.deleteMany(filter);
    if (deletedCount) removed[model] = deletedCount;
  };
  const anyOf = (...parts: (any | null)[]) => {
    const live = parts.filter(Boolean);
    return live.length ? { $or: live } : null;
  };

  await drop('Lecture', anyOf(
    classes.length ? { classId: { $in: classes } } : null,
    offerings.length ? { subjectOfferingId: { $in: offerings } } : null,
    terms.length ? { termId: { $in: terms } } : null,
  ));
  await drop('TeacherAssignment', anyOf(
    classes.length ? { classId: { $in: classes } } : null,
    offerings.length ? { subjectOfferingId: { $in: offerings } } : null,
  ));
  await drop('GradesCriteria', offerings.length ? { subjectOfferingId: { $in: offerings } } : null);
  await drop('TeacherConstraint', terms.length ? { termId: { $in: terms } } : null);
  await drop('SubjectOffering', offerings.length ? { _id: { $in: offerings } } : null);
  await drop('Class', classes.length ? { _id: { $in: classes } } : null);
  await drop('Term', terms.length ? { _id: { $in: terms } } : null);
  if (scope.yearId) {
    await drop('FeeConfig', { academicYearId: scope.yearId });
    await drop('AdditionalFee', { targetAcademicYearId: scope.yearId });
  }
  return removed;
}

/**
 * Leftovers of deletes made before the cascade existed, in one school.
 *
 * Dead means the parent is gone: a term or class whose year was deleted, an
 * offering whose term was deleted. Their timetable, teacher assignments and
 * availability go. An offering or class still holding work is kept and
 * reported, never deleted. A period a lesson plan, a tracking sheet or a
 * cover still points at is kept too, so no record loses its period.
 * Nothing is written unless `commit`.
 */
export async function cleanupLeftovers(conn: Connection, schoolId: Types.ObjectId, commit: boolean) {
  const col = (model: string) => collection(conn, model);
  const rows = async (model: string, projection: any) => {
    const c = col(model);
    return c ? ((await c.find({ schoolId }, { projection }).toArray()) as any[]) : [];
  };
  const key = (v: any) => String(v ?? '');

  const years = new Set((await rows('AcademicYear', { _id: 1 })).map((r) => key(r._id)));
  const terms = await rows('Term', { academicYearId: 1 });
  const classes = await rows('Class', { academicYearId: 1, name: 1 });
  const offerings = await rows('SubjectOffering', { termId: 1 });

  const deadTerms = terms.filter((t) => !years.has(key(t.academicYearId)));
  const liveTerms = new Set(terms.filter((t) => years.has(key(t.academicYearId))).map((t) => key(t._id)));
  const deadOfferings = offerings.filter((o) => !liveTerms.has(key(o.termId)));
  const deadClasses = classes.filter((c) => !years.has(key(c.academicYearId)));

  // Dead rows still holding work stay, and are reported.
  const kept: string[] = [];
  const removableOfferings: Types.ObjectId[] = [];
  for (const o of deadOfferings) {
    const work = await workUnder(conn, { offeringIds: [o._id] });
    if (work.length) kept.push(`مادة صف من عام محذوف (${key(o._id)}): ${work.join('، ')}`);
    else removableOfferings.push(o._id);
  }
  const removableClasses: Types.ObjectId[] = [];
  for (const c of deadClasses) {
    const work = await workUnder(conn, { classIds: [c._id] });
    if (work.length) kept.push(`فصل من عام محذوف «${c.name}»: ${work.join('، ')}`);
    else removableClasses.push(c._id);
  }
  const keptOfferingTerms = new Set(
    deadOfferings.filter((o) => !removableOfferings.some((r) => r.equals(o._id))).map((o) => key(o.termId)),
  );
  const removableTerms = deadTerms.filter((t) => !keptOfferingTerms.has(key(t._id))).map((t) => t._id);

  // Periods something still points at.
  const pinned = new Set<string>();
  for (const [model, field] of [['Preparation', 'lecture'], ['DailyTracking', 'lectureId'], ['Substitution', 'lectureId']]) {
    const c = col(model);
    if (c) (await c.distinct(field, { schoolId })).forEach((id: any) => pinned.add(key(id)));
  }

  const liveOfferingIds = offerings
    .filter((o) => liveTerms.has(key(o.termId)))
    .map((o) => o._id);
  const liveClassIds = classes.filter((c) => years.has(key(c.academicYearId))).map((c) => c._id);
  const allOfferingIds = offerings.map((o) => o._id);

  const criteriaInUse: any[] = [];
  for (const model of ['Exam', 'Project']) {
    const c = col(model);
    if (c) criteriaInUse.push(...(await c.distinct('gradesCriteriaId', { schoolId })));
  }

  const plan: [string, any][] = [
    ['Lecture', {
      schoolId,
      $or: [{ classId: { $nin: liveClassIds } }, { subjectOfferingId: { $nin: liveOfferingIds } }],
    }],
    ['TeacherAssignment', {
      schoolId,
      $or: [
        { subjectOfferingId: { $nin: liveOfferingIds } },
        { classId: { $ne: null, $nin: liveClassIds } },
      ],
    }],
    ['GradesCriteria', {
      schoolId,
      // A distribution an exam or project still points at is the scale its
      // marks were set on.
      _id: { $nin: criteriaInUse },
      $or: [{ subjectOfferingId: { $nin: allOfferingIds } }, { subjectOfferingId: { $in: removableOfferings } }],
    }],
    ['TeacherConstraint', { schoolId, termId: { $nin: [...liveTerms].map((t) => new Types.ObjectId(t)) } }],
    ['SubjectOffering', { schoolId, _id: { $in: removableOfferings } }],
    ['Class', { schoolId, _id: { $in: removableClasses } }],
    ['Term', { schoolId, _id: { $in: removableTerms } }],
  ];

  const counts: Record<string, number> = {};
  for (const [model, filter] of plan) {
    const c = col(model);
    if (!c) continue;
    let target = filter;
    if (model === 'Lecture' && pinned.size) {
      const ids = ((await c.find(filter, { projection: { _id: 1 } }).toArray()) as any[])
        .map((r) => r._id)
        .filter((id) => !pinned.has(key(id)));
      target = { _id: { $in: ids } };
      const held = (await c.countDocuments(filter)) - ids.length;
      if (held) kept.push(`${held} حصة من جدول قديم مرتبطة بتحضير أو متابعة أو احتياط`);
    }
    counts[model] = commit ? (await c.deleteMany(target)).deletedCount : await c.countDocuments(target);
  }
  return { commit, wouldRemove: commit ? undefined : counts, removed: commit ? counts : undefined, kept };
}
