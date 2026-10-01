import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const EXCUSE_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ExcuseStatus = (typeof EXCUSE_STATUSES)[number];

/**
 * عذر غياب معلم — a teacher's account of a day she was not at school.
 *
 * A collection of its own, and not fields on TeacherAttendance, for a reason
 * that decides the whole design: a teacher's absence has no record. Presence
 * is a row written at check-in, and `findAbsent` works by subtraction —
 * everyone active who has no row for that day. The absent teacher is the one
 * with nothing to attach an excuse to.
 *
 * Putting the excuse on TeacherAttendance would mean writing an attendance
 * row for somebody who did not attend, which would then count her present
 * and quietly empty the absence report it exists to explain.
 *
 * This is also why the feature is safe: nothing here is read by the
 * attendance calculation. Drop this collection and the system behaves
 * exactly as it did before.
 *
 * It mirrors the student flow (attendance.submitExcuse) and the lateness flow
 * (submitLateReason) deliberately — a school should not have to learn three
 * different shapes for the same conversation.
 */
@Schema({ collection: 'teacherAbsenceExcuses', timestamps: true })
export class TeacherAbsenceExcuse extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true,
  })
  teacherId: Types.ObjectId;

  /** Denormalised so the review list reads without a populate. */
  @Prop({ type: String, default: '' })
  teacherName: string;

  /** The day itself, at UTC midnight — a calendar day, not an instant. */
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  /** The teacher's own account. Written once; see the service. */
  @Prop({ type: String, required: true })
  reason: string;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  /** A medical note or similar, served from /uploads. */
  @Prop({ type: String, default: null })
  attachment: string | null;

  /**
   * Where the excuse stands with the school.
   *
   * Starts at 'pending' rather than null: it is waiting on somebody from the
   * moment it is written, and a null here would leave it in a state the
   * review list does not query.
   */
  @Prop({ type: String, enum: EXCUSE_STATUSES, default: 'pending', index: true })
  status: ExcuseStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  reviewedByName: string;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  /** Why it was accepted or refused — the teacher is told this. */
  @Prop({ type: String, default: '' })
  reviewNote: string;
}

export const TeacherAbsenceExcuseSchema =
  SchemaFactory.createForClass(TeacherAbsenceExcuse);
TeacherAbsenceExcuseSchema.plugin(tenantScopedPlugin);

// One excuse per teacher per day. Re-sending is a conflict, not a second row:
// an explanation a manager has already ruled on must not be quietly replaced.
TeacherAbsenceExcuseSchema.index(
  { schoolId: 1, teacherId: 1, date: 1 },
  { unique: true },
);

// The school's queue: what is waiting to be looked at, newest first.
TeacherAbsenceExcuseSchema.index({ schoolId: 1, status: 1, submittedAt: -1 });

// The monthly report, which reads a teacher's excused days over a range.
TeacherAbsenceExcuseSchema.index({ schoolId: 1, teacherId: 1, date: -1 });
