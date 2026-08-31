import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/**
 * A teacher asking to leave before the end of the day (استئذان).
 *
 * Approval matters beyond the courtesy: attendance snapshots
 * `earlyLeaveMinutes` at check-out, and an approved request is what stops a
 * sanctioned departure being recorded as leaving early. It is also what tells
 * the cover screen which lectures need somebody else.
 */
@Schema({ collection: 'leaveRequests', timestamps: true })
export class LeaveRequest extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true,
  })
  teacherId: Types.ObjectId;

  /** Denormalised so a list does not have to populate to be readable. */
  @Prop({ type: String, default: '' })
  teacherName: string;

  /** The day itself, at UTC midnight — a calendar day, not an instant. */
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  /** "HH:mm" in the school's timezone. What the teacher is asking for. */
  @Prop({ type: String, required: true })
  leaveAt: string;

  /**
   * The first lecture the teacher will miss.
   *
   * Optional, and more useful than the time it sits beside: the school has no
   * per-slot clock times, so "11:00" cannot be turned into "from the fourth
   * period" by calculation. Teachers think in periods anyway. Left empty, the
   * cover screen offers every one of that day's lectures and the manager
   * decides.
   */
  @Prop({ type: Number, default: null, min: 1, max: 10 })
  fromSlot: number | null;

  @Prop({ type: String, default: '' })
  reason: string;

  @Prop({
    type: String,
    enum: LEAVE_STATUSES,
    default: 'pending',
    index: true,
  })
  status: LeaveStatus;

  /** No ref: an approver may be an owner, a manager or a promoted teacher. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  reviewedByName: string;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @Prop({ type: String, default: '' })
  reviewNote: string;

  schoolId?: Types.ObjectId;
}

export const LeaveRequestSchema = SchemaFactory.createForClass(LeaveRequest);
LeaveRequestSchema.plugin(tenantScopedPlugin);

// One request per teacher per day. A second is an edit of the first, not a
// separate ask — otherwise "is this teacher excused today?" has no answer.
LeaveRequestSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });
LeaveRequestSchema.index({ schoolId: 1, date: 1, status: 1 });
