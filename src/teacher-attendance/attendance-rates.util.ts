/**
 * Attendance and punctuality as percentages.
 *
 * Kept apart from the teacher service so the staff summary can reuse the
 * same arithmetic later: two reports that round or pool differently would
 * show a director two different numbers for the same thing.
 */
import { WEEKDAY_NAMES, WeekdayName, weekdayOf } from './teacher-presence.util';

/** One decimal, as the student side rounds (class-record). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** part / whole as a percentage with one decimal; null when there is no whole. */
export function rateOf(part: number, whole: number): number | null {
  return whole > 0 ? round1((part / whole) * 100) : null;
}

/** What a row needs to be turned into rates. */
export interface RateInputs {
  workingDays: number;
  daysAbsent: number;
  daysPresent: number;
  daysLate: number;
  daysLatenessNotTracked: number;
}

/** Days present on which lateness was measured — a day with no start time is not "on time". */
export function trackedDays(row: Partial<RateInputs>): number {
  return Math.max(0, (row.daysPresent ?? 0) - (row.daysLatenessNotTracked ?? 0));
}

/** attendanceRate and punctualityRate for one teacher. */
export function rowRates(row: Partial<RateInputs>) {
  const workingDays = row.workingDays ?? 0;
  const tracked = trackedDays(row);
  return {
    attendanceRate: rateOf(workingDays - (row.daysAbsent ?? 0), workingDays),
    punctualityRate: rateOf(tracked - (row.daysLate ?? 0), tracked),
  };
}

/**
 * The same two rates over many teachers, pooled: Σ attended / Σ expected.
 * Not an average of averages — a teacher who works two days a week must not
 * weigh as much as one who works five.
 */
export function pooledRates(rows: Partial<RateInputs>[]) {
  let attended = 0;
  let expected = 0;
  let onTime = 0;
  let tracked = 0;
  for (const row of rows) {
    const days = row.workingDays ?? 0;
    expected += days;
    attended += days - (row.daysAbsent ?? 0);
    const t = trackedDays(row);
    tracked += t;
    onTime += t - (row.daysLate ?? 0);
  }
  return {
    attendanceRate: rateOf(attended, expected),
    punctualityRate: rateOf(onTime, tracked),
  };
}

/** Counts for one school day, before they become a snapshot. */
export interface DayCounts {
  expected: number;
  present: number;
  late: number;
  latenessNotTracked: number;
  leftEarly: number;
  /** Absent teachers with an accepted excuse for the day. */
  absentExcused: number;
}

/**
 * One school day across all teachers.
 *
 * Until the day ends nobody is absent — a teacher with no record is "not in
 * yet" — so `absent` is null and the gap shows as `notCheckedIn`.
 */
export function daySnapshot(date: string, counts: DayCounts, dayEnded: boolean) {
  const onTime = Math.max(0, counts.present - counts.late - counts.latenessNotTracked);
  const missing = Math.max(0, counts.expected - counts.present);
  return {
    date,
    isWorkingDay: true as const,
    dayEnded,
    expected: counts.expected,
    present: counts.present,
    onTime,
    late: counts.late,
    latenessNotTracked: counts.latenessNotTracked,
    notCheckedIn: dayEnded ? 0 : missing,
    absent: dayEnded ? missing : null,
    absentExcused: dayEnded ? counts.absentExcused : null,
    leftEarly: counts.leftEarly,
    attendanceRate: rateOf(counts.present, counts.expected),
    punctualityRate: rateOf(onTime, counts.present - counts.latenessNotTracked),
  };
}

export type DaySnapshot = ReturnType<typeof daySnapshot>;

/** A day the school does not work: nobody is expected, so nothing is counted. */
export function closedDay(date: string) {
  return {
    date,
    isWorkingDay: false as const,
    dayEnded: null,
    expected: null,
    present: null,
    onTime: null,
    late: null,
    latenessNotTracked: null,
    notCheckedIn: null,
    absent: null,
    absentExcused: null,
    leftEarly: null,
    attendanceRate: null,
    punctualityRate: null,
  };
}

/** One entry of overview.daily. */
export interface DailyEntry {
  date: string;
  expected: number;
  present: number;
  late: number;
  absent: number;
  absentExcused: number;
  attendanceRate: number | null;
  punctualityRate: number | null;
  /** Kept for byWeekday; not returned. */
  latenessNotTracked?: number;
}

/**
 * Pooled per weekday over `daily`. Only weekdays that appear — the ones the
 * school works — in Sunday-first order.
 */
export function byWeekday(daily: DailyEntry[]) {
  const acc = new Map<WeekdayName, { days: number; expected: number; present: number; onTime: number; tracked: number }>();
  for (const day of daily) {
    const name = weekdayOf(new Date(`${day.date}T00:00:00.000Z`));
    const a = acc.get(name) ?? { days: 0, expected: 0, present: 0, onTime: 0, tracked: 0 };
    const tracked = day.present - (day.latenessNotTracked ?? 0);
    a.days += 1;
    a.expected += day.expected;
    a.present += day.present;
    a.tracked += tracked;
    a.onTime += tracked - day.late;
    acc.set(name, a);
  }
  return WEEKDAY_NAMES.filter((name) => acc.has(name)).map((weekday) => {
    const a = acc.get(weekday)!;
    return {
      weekday,
      days: a.days,
      attendanceRate: rateOf(a.present, a.expected),
      punctualityRate: rateOf(a.onTime, a.tracked),
    };
  });
}
