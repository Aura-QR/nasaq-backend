import { WEEKDAYS } from '../platform/schools/schemas/school.schema';

/**
 * The school's settings as one staff member works them.
 *
 * A guard opens the gate at 6:30, half an hour before the school day; a
 * cleaner may work a Saturday the school does not. A staff member's own day
 * replaces the school's day of the same name; a day they have none for, and
 * everyone with no schedule of their own, keeps the school's. Holidays stay
 * the school's: `findHoliday` reads them from the same settings.
 *
 * Every staff lateness, early-leave, working-day and absence figure goes
 * through `resolveDaySchedule(settingsForStaff(settings, staff), date)`.
 */
export function settingsForStaff(settings: any, staff: any): any {
  const own: any[] = Array.isArray(staff?.workSchedule) ? staff.workSchedule : [];
  if (!own.length) return settings;
  const school: any[] = Array.isArray(settings?.workSchedule) ? settings.workSchedule : [];
  const dayOf = (list: any[], day: string) => list.find((d) => d?.day === day);
  return {
    ...settings,
    workSchedule: WEEKDAYS.map((day) => dayOf(own, day) ?? dayOf(school, day)).filter(Boolean),
  };
}
