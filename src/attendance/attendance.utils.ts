import { BadRequestException } from '@nestjs/common';

export function calculateHaversineDistance(
  coords1: { lat: number; lng: number },
  coords2: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = (coords2.lat - coords1.lat) * (Math.PI / 180);
  const dLng = (coords2.lng - coords1.lng) * (Math.PI / 180);
  const lat1Rad = coords1.lat * (Math.PI / 180);
  const lat2Rad = coords2.lat * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function normalizeDate(dateInput?: string | Date): Date {
  const d = dateInput ? new Date(dateInput) : new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Resolve a wall-clock time using the offset on that date, including DST.
 * Ambiguous/nonexistent local times need an explicit ISO offset instead.
 */
export function parseCheckInTime(
  dateInput: string | Date,
  timeOrIsoStr: string,
  timezone = 'Asia/Riyadh',
): Date {
  const invalid = () => new BadRequestException('وقت غير صالح؛ استخدم HH:mm بتوقيت المدرسة أو ISO مع إزاحة زمنية');
  if (typeof timeOrIsoStr !== 'string') throw invalid();
  const instantPattern = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const validDate = (key: string) => {
    const day = new Date(key + 'T00:00:00.000Z');
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === key;
  };
  if (instantPattern.test(timeOrIsoStr)) {
    const instant = new Date(timeOrIsoStr);
    if (!validDate(timeOrIsoStr.slice(0, 10)) || !Number.isFinite(instant.getTime())) throw invalid();
    return instant;
  }

  // Retain support for old offset-less ISO clients, interpreting their clock
  // in the school timezone as well. Explicit-offset ISO always stays an instant.
  const localIso = timeOrIsoStr.match(/^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)$/);
  const date = localIso ? localIso[1] : dateInput instanceof Date
    ? dateInput.toISOString().slice(0, 10) : String(dateInput);
  const time = localIso ? localIso[2] : timeOrIsoStr;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validDate(date) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time)) throw invalid();

  const desired = new Date(date + 'T' + (time.length === 5 ? time + ':00' : time) + 'Z').getTime();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const wallAsUtc = (timestamp: number) => {
      const parts = formatter.formatToParts(new Date(timestamp));
      const read = (key: string) => Number(parts.find(p => p.type === key)?.value);
      return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
    };
    const whole = Math.floor(desired / 1000) * 1000;
    const offsets = new Set([-36, 0, 36].map(h => {
      const sample = whole + h * 3600000;
      return wallAsUtc(sample) - sample;
    }));
    const matches = [...offsets].map(offset => desired - offset)
      .filter(candidate => wallAsUtc(candidate) === whole);
    if (matches.length !== 1) throw invalid();
    return new Date(matches[0]);
  } catch {
    throw invalid();
  }
}
/**
 * How many minutes past the school's official start did this check-in land?
 *
 * The timezone handling here is the whole point.
 *
 * `checkInAt` is a real instant — `new Date()` at the moment the teacher tapped.
 * `workStartTime` is a wall-clock string, "07:30", meaning half past seven
 * WHERE THE SCHOOL IS. Those two cannot be compared without knowing the
 * school's offset.
 *
 * Building "07:30" as a UTC instant and subtracting, which is the obvious
 * thing to write, is wrong in a way that never raises: a school on
 * Asia/Riyadh (UTC+3) has a teacher arriving 07:50 local — 04:50 UTC — so the
 * subtraction gives -160, max(0, …) makes it 0, and EVERY teacher is on time
 * forever. West of Greenwich the same code makes everyone permanently late.
 *
 * So the comparison is done in wall-clock terms on both sides: format the
 * instant into the school's timezone and read the hours and minutes back out.
 * Intl carries the tz database, including DST, with no dependency.
 *
 * Returns null when the school has not set a start time — lateness is not
 * zero in that case, it is unknown, and the two must not be conflated.
 */
export function computeLateMinutes(
  checkInAt: Date,
  workStartTime?: string | null,
  timezone?: string | null,
): number | null {
  const diff = minutesFromWallClock(checkInAt, workStartTime, timezone);
  return diff === null ? null : Math.max(0, diff);
}

/**
 * How many minutes before the school's official end did this check-out land?
 *
 * The mirror of computeLateMinutes, and it needs the same care: reading the
 * instant as UTC would make everyone in a UTC+ school look like they left
 * early, every single day.
 *
 * Returns null when the day has no end time — unknown, not zero.
 */
export function computeEarlyLeaveMinutes(
  checkOutAt: Date,
  workEndTime?: string | null,
  timezone?: string | null,
): number | null {
  const diff = minutesFromWallClock(checkOutAt, workEndTime, timezone);
  return diff === null ? null : Math.max(0, -diff);
}

/**
 * Minutes between an instant and a "HH:mm" reference, both read as wall-clock
 * time in the given timezone. Positive means the instant is later.
 *
 * The timezone handling here is the whole point. `instant` is a real moment;
 * `reference` is a wall-clock string meaning that time WHERE THE SCHOOL IS.
 * Building "07:30" as a UTC instant and subtracting — the obvious thing to
 * write — is wrong in a way that never raises: on Asia/Riyadh (UTC+3, the
 * default here) a teacher arriving 07:50 local is 04:50 UTC, the difference is
 * negative, and every teacher is on time forever. West of Greenwich everyone
 * is permanently late instead.
 *
 * Intl carries the tz database, including DST, with no dependency.
 */
function minutesFromWallClock(
  instant: Date,
  reference?: string | null,
  timezone?: string | null,
): number | null {
  if (!reference || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reference)) return null;

  const [startHours, startMinutes] = reference.split(':').map(Number);

  let localHours: number;
  let localMinutes: number;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(instant);

    const read = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    localHours = read('hour');
    localMinutes = read('minute');

    // Intl renders midnight as "24" in some ICU versions.
    if (localHours === 24) localHours = 0;
  } catch {
    // An unknown timezone string would otherwise throw and take the whole
    // check-in down. Losing the figure is the smaller failure.
    return null;
  }

  if (!Number.isFinite(localHours) || !Number.isFinite(localMinutes))
    return null;

  return localHours * 60 + localMinutes - (startHours * 60 + startMinutes);
}

/** Index matches Date.getUTCDay(): 0 = Sunday. */
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export interface DaySchedule {
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  /** How long the day is meant to be, or null when its hours are not set. */
  expectedWorkMinutes: number | null;
  /**
   * The declared holiday that closed this day, when one did.
   *
   * A day off is a day off either way, but "إجازة" and "إجازة عيد الفطر" are
   * not the same answer to a teacher asking why the app will not let them
   * clock in.
   */
  holidayName?: string | null;
}

/**
 * The declared holiday covering a date, if any.
 *
 * Ranges are inclusive at both ends and compared at UTC midnight, which is
 * how every date in this system is keyed — so a holiday that starts today
 * closes today, not tomorrow.
 */
export function findHoliday(settings: any, date: Date): { name: string } | null {
  const holidays = settings?.holidays;
  if (!Array.isArray(holidays) || holidays.length === 0) return null;

  const day = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  for (const holiday of holidays) {
    const from = holiday?.startDate ? new Date(holiday.startDate) : null;
    const to = holiday?.endDate ? new Date(holiday.endDate) : from;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      continue;
    }

    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    // A range entered backwards is a typo, not an empty range: treating it as
    // empty would silently drop a holiday somebody believes they declared.
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);

    if (day >= lower && day <= upper) {
      return { name: String(holiday.name ?? '').trim() || 'إجازة' };
    }
  }

  return null;
}

/**
 * The school's hours for the weekday a given date falls on.
 *
 * `date` is the record's own normalised date — built from the intended
 * calendar day at UTC midnight — so its UTC weekday IS the school's weekday.
 *
 * A school with no schedule configured gets every day treated as a working day
 * with no hours: exactly the behaviour it has today, so nothing changes for a
 * school that has not set this up.
 */
/**
 * The school's working days between two dates, inclusive.
 *
 * Absence cannot be aggregated out of an attendance collection — it is the
 * days with no record at all — so it has to be counted against the school's
 * own week. Both the teacher and the staff report need exactly this, and a
 * second copy of it would be a second answer to "how long was September".
 *
 * Weekly days off and declared holidays only: `resolveDaySchedule` decides
 * each day, so whatever closes a day for check-in closes it here too.
 */
export function workingDatesBetween(
  settings: any,
  from: Date,
  to: Date,
): Date[] {
  const dates: Date[] = [];
  if (!from || !to || from > to) return dates;

  const cursor = new Date(from);
  // A guard, not a rule: an accidental ten-year range should not spin here.
  for (let guard = 0; cursor <= to && guard < 1000; guard++) {
    if (resolveDaySchedule(settings, cursor).isWorkingDay) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function resolveDaySchedule(settings: any, date: Date): DaySchedule {
  const schedule = settings?.workSchedule;
  const fallback: DaySchedule = {
    isWorkingDay: true,
    startTime: null,
    endTime: null,
    expectedWorkMinutes: null,
    holidayName: null,
  };

  /*
   * A declared holiday closes the day whatever the weekly schedule says, and
   * it is checked first so that it also closes a school that has configured
   * no schedule at all.
   *
   * Every caller that asks "is this a working day" goes through here — the
   * absentee list, the monthly report, teacher and staff check-in — so
   * holidays are handled once rather than remembered in six places.
   */
  const holiday = findHoliday(settings, date);
  if (holiday) {
    return {
      isWorkingDay: false,
      startTime: null,
      endTime: null,
      expectedWorkMinutes: null,
      holidayName: holiday.name,
    };
  }

  if (!Array.isArray(schedule) || schedule.length === 0) return fallback;

  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const entry = schedule.find((d: any) => d?.day === weekday);
  if (!entry) return fallback;

  const isWorkingDay = entry.isWorkingDay !== false;
  // A day off has no hours to measure against, whatever is stored on it.
  const startTime = isWorkingDay ? (entry.startTime ?? null) : null;
  const endTime = isWorkingDay ? (entry.endTime ?? null) : null;

  let expectedWorkMinutes: number | null = null;
  if (startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const span = eh * 60 + em - (sh * 60 + sm);
    // A negative span would be a day that ends before it starts. Treat it as
    // unset rather than reporting a negative expectation.
    expectedWorkMinutes = span > 0 ? span : null;
  }

  return { isWorkingDay, startTime, endTime, expectedWorkMinutes, holidayName: null };
}

/**
 * The client's real IP.
 *
 * Reads ONLY req.ip. Express derives that from X-Forwarded-For using the
 * `trust proxy` hop count configured in main.ts, which means a value the caller
 * prepended to the header is discarded.
 *
 * Do NOT read req.headers['x-forwarded-for'] here. That header is set by the
 * client, so trusting its first element would let any teacher check in from
 * anywhere by sending the school's public IP in a header — the school-network
 * check would pass with no app and no network access.
 */
export function extractClientIp(req: any): string {
  if (!req) return '';
  const rawIp = req.ip || req.socket?.remoteAddress || '';
  return String(rawIp).replace(/^::ffff:/, '');
}
