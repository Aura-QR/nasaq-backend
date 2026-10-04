import { Model, Types } from 'mongoose';
import { normalizeDate } from '../attendance/attendance.utils';

/**
 * May a teacher act on a period because she is covering it today?
 *
 * The lecture-ownership checks in attendance and daily tracking compared the
 * caller with `lecture.teacherId` and nothing else. A teacher assigned as
 * substitute on the cover board was told «هذه ليست حصتك» on the very period
 * she had been sent to teach, so a covered period could never get its daily
 * tracking recorded by anyone.
 *
 * Cover is for one day: tomorrow the period belongs to its own teacher again.
 * A missing model or a malformed id answers false rather than throwing.
 */

const oid = (value: unknown): Types.ObjectId | null => {
  const raw = String(value ?? '');
  return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : null;
};

/** Is this teacher the recorded substitute for this lecture on this day? */
export async function coversLecture(
  substitutionModel: Model<any> | undefined,
  teacherId: unknown,
  lectureId: unknown,
  date: string | Date,
): Promise<boolean> {
  const teacher = oid(teacherId);
  const lecture = oid(lectureId);
  if (!substitutionModel || !teacher || !lecture) return false;

  const found = await substitutionModel
    .exists({ lectureId: lecture, substituteTeacherId: teacher, date: normalizeDate(date) });
  return Boolean(found);
}

/**
 * Is this teacher covering any period of this class on this day?
 *
 * Attendance is recorded per class per day, so the substitute of any one of
 * the class's periods may record it, the same as its own teachers may.
 */
export async function coversClass(
  substitutionModel: Model<any> | undefined,
  lectureModel: Model<any>,
  teacherId: unknown,
  classId: unknown,
  date: string | Date,
): Promise<boolean> {
  const teacher = oid(teacherId);
  const cls = oid(classId);
  if (!substitutionModel || !teacher || !cls) return false;

  const covers = await substitutionModel
    .find({ substituteTeacherId: teacher, date: normalizeDate(date) })
    .select('lectureId')
    .lean()
    .exec();
  if (!covers.length) return false;

  const found = await lectureModel.exists({
    _id: { $in: covers.map((c: any) => c.lectureId) },
    classId: cls,
  });
  return Boolean(found);
}
