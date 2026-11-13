/**
 * Pure helpers for سجل الحضور and ملخص الفصل, kept apart from the service so
 * the counting rules can be tested without a database.
 */

export type CellStatus = 'present' | 'absent' | 'excused' | null;

export interface AbsenceDay {
  date: string; // YYYY-MM-DD
  excuseStatus: 'pending' | 'accepted' | 'rejected' | null;
}

export const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * One student's row across the school days.
 *
 * A day before she joined is null («—»), not «حاضر»: a student enrolled in
 * November did not attend September, and counting it would lift her rate.
 * Only an ACCEPTED excuse makes a day «بعذر»; pending or rejected is absence.
 */
export function studentRow(days: string[], absences: AbsenceDay[], joinedOn?: string | null) {
  const byDay = new Map<string, AbsenceDay>();
  for (const a of absences) {
    // Two classes may record the same day; an accepted excuse on either wins.
    const prev = byDay.get(a.date);
    if (!prev || a.excuseStatus === 'accepted') byDay.set(a.date, a);
  }
  const cells: Record<string, CellStatus> = {};
  let counted = 0, absent = 0, excused = 0;
  for (const day of days) {
    if (joinedOn && day < joinedOn) { cells[day] = null; continue; }
    counted++;
    const a = byDay.get(day);
    if (!a) { cells[day] = 'present'; continue; }
    absent++;
    if (a.excuseStatus === 'accepted') { excused++; cells[day] = 'excused'; }
    else cells[day] = 'absent';
  }
  return {
    cells,
    countedDays: counted,
    absentDays: absent,
    excusedDays: excused,
    unexcusedDays: absent - excused,
    presentDays: counted - absent,
    attendanceRate: counted ? Math.round(((counted - absent) / counted) * 1000) / 10 : null,
  };
}

/** Distinct unexcused days — what حد الغياب is measured against. */
export function unexcusedDayCount(absences: AbsenceDay[]): number {
  const days = new Map<string, boolean>();
  for (const a of absences) {
    const excused = a.excuseStatus === 'accepted';
    days.set(a.date, (days.get(a.date) ?? false) || excused);
  }
  return [...days.values()].filter((excused) => !excused).length;
}

export const overLimit = (unexcused: number, limit: number | null | undefined) =>
  typeof limit === 'number' && limit > 0 && unexcused >= limit;

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * Grade figures for the summary, from the class grade report.
 * Average of every student-subject total; pass rate is the share not rated
 * «غير مجتاز». Subjects with no total yet are left out of both.
 */
export function gradeFigures(students: { totals?: Record<string, number | null>; ratings?: Record<string, any> }[]) {
  const totals: number[] = [];
  let rated = 0, passed = 0;
  for (const s of students) {
    for (const [off, t] of Object.entries(s.totals ?? {})) {
      if (typeof t !== 'number') continue;
      totals.push(t);
      const r = s.ratings?.[off];
      if (r) { rated++; if (r.key !== 'failed') passed++; }
    }
  }
  return {
    averageGrade: mean(totals),
    passRate: rated ? Math.round((passed / rated) * 1000) / 10 : null,
    gradedEntries: totals.length,
  };
}
