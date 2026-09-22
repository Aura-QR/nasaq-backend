import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const STAFF_LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type StaffLeaveStatus = (typeof STAFF_LEAVE_STATUSES)[number];

/**
 * A manager or supervisor asking to leave before the end of the day (استئذان).
 *
 * Its own collection rather than a flag on the teacher one, because the two
 * are not the same request. A teacher's leave is first of all a cover
 * problem: who takes the fourth period. A supervisor has no lectures, so
 * there is nothing to cover and none of the duty machinery applies — and
 * every query in that machinery is shaped around `teacherId`, down to the
 * unique index.
 *
 * What both share is the part that matters at check-out: an approved request
 * is what stops a sanctioned departure being recorded as leaving early.
 */
@Schema({ collection: 'staffLeaveRequests', timestamps: true })
export class StaffLeaveRequest extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  })
  staffId: Types.ObjectId;

  /** Denormalised so a list is readable without populating. */
  @Prop({ type: String, default: '' })
  staffName: string;

  @Prop({ type: String, default: '' })
  role: string;

  /** The day itself, at UTC midnight — a calendar day, not an instant. */
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  /** "HH:mm" in the school's timezone. What is being asked for. */
  @Prop({ type: String, required: true })
  leaveAt: string;

  @Prop({ type: String, default: '' })
  reason: string;

  @Prop({
    type: String,
    enum: STAFF_LEAVE_STATUSES,
    default: 'pending',
    index: true,
  })
  status: StaffLeaveStatus;

  /** No ref: an approver is an owner or a manager, both on Admin. */
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

export const StaffLeaveRequestSchema =
  SchemaFactory.createForClass(StaffLeaveRequest);
StaffLeaveRequestSchema.plugin(tenantScopedPlugin);

// One request per person per day. A second is an edit of the first, not a
// separate ask — otherwise "is this person excused today?" has no answer.
StaffLeaveRequestSchema.index(
  { schoolId: 1, staffId: 1, date: 1 },
  { unique: true },
);
StaffLeaveRequestSchema.index({ schoolId: 1, date: 1, status: 1 });
