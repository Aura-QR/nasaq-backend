/**
 * «نشاط غير دراسي» — a kindergarten breakfast, outdoor play, the morning
 * circle. It sits on the timetable like any period, with its class teacher
 * on it so her day and the cover board are whole, but nobody prepares it,
 * records tracking on it, or grades it.
 *
 * Off by default: every subject that existed before the flag behaves exactly
 * as it did. These helpers accept whatever shape a populate left behind.
 */
export const isActivitySubject = (subject: any): boolean =>
  Boolean(subject && typeof subject === 'object' && subject.isActivity === true);

/** A lecture whose subject offering was populated down to the subject. */
export const isActivityLecture = (lecture: any): boolean =>
  isActivitySubject(lecture?.subjectOfferingId?.subjectId);

export const ACTIVITY_NOT_PREPARED =
  'هذه الحصة نشاط غير دراسي، ولا تحتاج إلى تحضير';
export const ACTIVITY_NOT_TRACKED =
  'هذه الحصة نشاط غير دراسي، ولا يُرصد فيها حضور ولا متابعة';
