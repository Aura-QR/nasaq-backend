/**
 * Is a teacher expected at school on a given day, and has that day ended?
 *
 * One place for these rules, because four callers need them — the live
 * absence list, the monthly summary, the teacher's own list of days to
 * explain, and the end-of-day notice — and if they disagreed, a teacher
 * would be asked to explain a day the report does not call an absence.
 */

export const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** The weekday of a calendar day stored at UTC midnight. */
export function weekdayOf(date: Date): WeekdayName {
  return WEEKDAY_NAMES[date.getUTCDay()];
}

/**
 * Does this teacher work on this weekday?
 *
 * `workDays` unset, null or empty means every day the school works — which is
 * every teacher who existed before the field did, so none of them changes.
 * Empty is read as unset rather than "works no day": a teacher who works no
 * day is not active, and a cleared field in a form arrives as [].
 */
export function worksOn(workDays: string[] | null | undefined, date: Date): boolean {
  if (!Array.isArray(workDays) || workDays.length === 0) return true;
  return workDays.includes(weekdayOf(date));
}

/** YYYY-MM-DD for a day stored at UTC midnight. */
export function dayLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The school's calendar day and wall-clock minute right now.
 *
 * The server runs on UTC and the school does not. Between midnight and 03:00
 * Riyadh the two disagree about the date, and all day they disagree about
 * the hour — which is the whole question when deciding whether a school day
 * has finished.
 */
export function schoolNow(timezone?: string | null, now: Date = new Date()) {
  const tz = timezone || 'Asia/Riyadh';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const label = `${get('year')}-${get('month')}-${get('day')}`;

  return {
    label,
    date: new Date(`${label}T00:00:00.000Z`),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** "13:10" → 790. null for anything that is not HH:mm. */
export function minutesOf(time: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Has today's school day ended, plus a margin?
 *
 * Until it has, a teacher with no check-in is "not here yet", not absent —
 * she may be on her way. A day with no configured end time is treated as
 * running until midnight, so nobody is asked about it until tomorrow.
 */
export function schoolDayHasEnded(
  endTime: string | null | undefined,
  nowMinutes: number,
  marginMinutes = 0,
): boolean {
  const end = minutesOf(endTime);
  if (end === null) return false;
  return nowMinutes >= end + marginMinutes;
}
