import { WEEK_DAYS, WeekDayName, lessonDateFor } from './utils/week.util';

/** The minimum a lecture needs for working out when the class next meets. */
export interface TimetableSlot {
  _id?: any;
  dayOfWeek: string;
  slot: number;
}

const dayIndex = (day: string) => WEEK_DAYS.indexOf(String(day ?? '').toLowerCase() as WeekDayName);

/**
 * When homework set in this lecture is due: the class's next lesson in the
 * same subject.
 *
 * A teacher sets homework at the end of a period and checks it at the start
 * of the next one, which is what every school means by «الواجب للحصة القادمة».
 * Working the date out here means the teacher never types it, the student
 * sees a real day on «واجباتي», and the daily-tracking sheet on that day can
 * say which homework it is marking.
 *
 * `siblings` are the timetable's lectures for the same class, subject and
 * term, the current one included. Later in the same week wins; otherwise the
 * first of them in the following week. Holidays are not known here, so a due
 * date may land on one; the teacher can change it.
 */
export function nextLessonDate(
  weekOf: Date | null | undefined,
  current: TimetableSlot | null | undefined,
  siblings: TimetableSlot[],
): Date | null {
  if (!weekOf || !current || dayIndex(current.dayOfWeek) < 0) return null;
  const order = (l: TimetableSlot) => dayIndex(l.dayOfWeek) * 100 + Number(l.slot ?? 0);
  const valid = [...siblings, current]
    .filter((l) => dayIndex(l.dayOfWeek) >= 0)
    .sort((a, b) => order(a) - order(b));
  const here = order(current);

  const later = valid.find((l) => order(l) > here);
  if (later) return lessonDateFor(weekOf, later.dayOfWeek);

  // Nothing later this week: the earliest meeting of next week, which is the
  // same lecture again when the subject meets once a week.
  const next = new Date(weekOf);
  next.setUTCDate(next.getUTCDate() + 7);
  return lessonDateFor(next, valid[0].dayOfWeek);
}

/** `YYYY-MM-DD` of a stored date, or null. Dates here are calendar days. */
export function dayKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
