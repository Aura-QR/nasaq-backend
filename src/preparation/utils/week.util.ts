import { BadRequestException } from '@nestjs/common';

/**
 * The school week runs Saturday → Friday.
 *
 * This matches the existing weekly cleanup cron, which fires Friday 00:00
 * Africa/Cairo to close out a week of teaching that ran Sunday–Thursday. Weeks
 * are anchored on the Saturday so that every teaching day of a week shares one
 * `weekOf` value.
 */
const SATURDAY = 6; // Date#getUTCDay()

/** Ordered from the week's anchor day, so index === offset from `weekOf`. */
export const WEEK_DAYS = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const;

export type WeekDayName = (typeof WEEK_DAYS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dates here are wall-clock calendar days, not instants — a lesson on the 24th
 * is on the 24th in every timezone. Parsing at UTC midnight keeps them from
 * drifting a day when the server and the school disagree about the offset.
 */
export function parseDateOnly(value: string | Date, field = 'date'): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException(`قيمة ${field} غير صالحة`);
    }
    return value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new BadRequestException(`قيمة ${field} مطلوبة`);
  }

  // Accept a full ISO instant too — clients send `toISOString()` output.
  const source = DATE_ONLY.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `قيمة ${field} غير صالحة: "${raw}" — الصيغة المتوقعة YYYY-MM-DD`,
    );
  }
  return parsed;
}

/** The Saturday 00:00 UTC that opens the week containing `value`. */
export function startOfWeek(value: string | Date, field = 'weekOf'): Date {
  const parsed = parseDateOnly(value, field);
  const anchor = new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
  // getUTCDay(): Sun=0 … Sat=6. Days elapsed since the most recent Saturday.
  const offset = (anchor.getUTCDay() - SATURDAY + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - offset);
  return anchor;
}

/** The week currently in progress. */
export function currentWeekOf(now: Date = new Date()): Date {
  return startOfWeek(now);
}

/**
 * The calendar day a lecture falls on inside a given week — the whole reason
 * the teacher never has to type a date.
 */
export function lessonDateFor(
  weekOf: Date,
  dayOfWeek: string | null | undefined,
): Date | null {
  if (!weekOf) return null;
  const index = WEEK_DAYS.indexOf(
    String(dayOfWeek ?? '').toLowerCase() as WeekDayName,
  );
  if (index < 0) return null;

  const date = new Date(weekOf);
  date.setUTCDate(date.getUTCDate() + index);
  return date;
}

/** `YYYY-MM-DD`, for responses where a full ISO instant would only mislead. */
export function toDateOnlyString(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}
