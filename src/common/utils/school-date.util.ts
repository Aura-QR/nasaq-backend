/**
 * The school's own calendar day.
 *
 * Extracted from `preparation/utils/week.util.ts`, which still re-exports
 * these so its own callers are untouched. It moved here because a second
 * feature needed it — the daily tracking record — and a school that disagrees
 * with itself about what day it is writes rows nobody can find again.
 */

/**
 * Every school on the platform is in the Gulf, and `schools.settings.timezone`
 * reads 'Asia/Riyadh'. A constant rather than a lookup: the callers resolve a
 * default before they have loaded the school, and a day that changes with the
 * reader is worse than one that is fixed.
 */
export const SCHOOL_TIME_ZONE = 'Asia/Riyadh';

/**
 * Today's calendar date where the school is, not where the server is.
 *
 * The server runs on UTC and the school is three hours ahead, so between
 * midnight and 03:00 Riyadh the two disagree about what day it is. A lesson at
 * 2am Riyadh would be filed under yesterday and vanish from today's sheet.
 */
export function todayAtSchool(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which parseDateOnly accepts directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
