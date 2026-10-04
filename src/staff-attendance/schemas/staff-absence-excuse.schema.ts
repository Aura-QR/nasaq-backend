import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';
import {
  EXCUSE_STATUSES,
  ExcuseStatus,
} from '../../teacher-attendance/schemas/teacher-absence-excuse.schema';

/**
 * عذر غياب موظف — a supervisor's, manager's or service worker's account of a
 * day they were not at school.
 *
 * The staff twin of TeacherAbsenceExcuse, and separate from StaffAttendance
 * for the same reason: an absence has no attendance record to hang an excuse
 * on, and writing one would count the person present. Nothing here is read
 * by the absence calculation; an accepted excuse marks an absence, it does
 * not remove it.
 *
 * Unlike a teacher, a cleaner may have no phone at all. So an excuse can also
 * be entered by the school on their behalf (`recordedBy`), and is then
 * accepted at once: the person typing it is the person who would review it.
 */
@Schema({ collection: 'staffAbsenceExcuses', timestamps: true })
export class StaffAbsenceExcuse extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true, index: true })
  staffId: Types.ObjectId;

  /** Denormalised so the review list reads without a populate. */
  @Prop({ type: String, default: '' })
  staffName: string;

  /** MANAGER, SUPERVISOR or STAFF at the time of the excuse. */
  @Prop({ type: String, default: '' })
  role: string;

  /** The day itself, at UTC midnight — a calendar day, not an instant. */
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  @Prop({ type: String, required: true })
  reason: string;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  /** A medical note or similar, served from /uploads. */
  @Prop({ type: String, default: null })
  attachment: string | null;

  @Prop({ type: String, enum: EXCUSE_STATUSES, default: 'pending', index: true })
  status: ExcuseStatus;

  /** Set when the school wrote it on the person's behalf; null when they did. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  recordedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  recordedByName: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  reviewedByName: string;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @Prop({ type: String, default: '' })
  reviewNote: string;
}

export const StaffAbsenceExcuseSchema = SchemaFactory.createForClass(StaffAbsenceExcuse);
StaffAbsenceExcuseSchema.plugin(tenantScopedPlugin);

// One excuse per person per day. A ruled-on explanation is never replaced.
StaffAbsenceExcuseSchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
// The school's queue.
StaffAbsenceExcuseSchema.index({ schoolId: 1, status: 1, submittedAt: -1 });

/**
 * That a staff member has been asked about a given day's absence — so the
 * end-of-day notice goes out once however often the sweep runs.
 */
@Schema({ collection: 'staffAbsenceNotices', timestamps: true })
export class StaffAbsenceNotice extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  staffId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date;
}

export const StaffAbsenceNoticeSchema = SchemaFactory.createForClass(StaffAbsenceNotice);
StaffAbsenceNoticeSchema.plugin(tenantScopedPlugin);
StaffAbsenceNoticeSchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
