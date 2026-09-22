import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';
import { ATTENDANCE_STAFF_ROLES } from '../dto/staff-attendance.dto';

@Schema({ collection: 'staffAttendance', timestamps: true })
export class StaffAttendance extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Admin' })
  staffId: Types.ObjectId;

  @Prop({ required: true, enum: ATTENDANCE_STAFF_ROLES })
  role: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Date, required: true })
  checkInAt: Date;

  @Prop({ type: Date, default: null })
  checkOutAt: Date | null;

  @Prop({ required: true, enum: ['location', 'manual'] })
  method: string;

  @Prop({ type: String, enum: ['location', 'manual'], default: null })
  checkOutMethod: string | null;

  @Prop({ type: { lat: Number, lng: Number, _id: false }, default: null })
  coordinates: { lat: number; lng: number } | null;

  @Prop({ type: { lat: Number, lng: Number, _id: false }, default: null })
  checkOutCoordinates: { lat: number; lng: number } | null;

  @Prop({ type: Number, default: null })
  distanceMeters: number | null;

  @Prop({ type: Number, default: null })
  checkOutDistanceMeters: number | null;

  @Prop({
    type: { gps: Boolean, network: Boolean, _id: false },
    default: () => ({ gps: false, network: false }),
  })
  verification: { gps: boolean; network: boolean };

  @Prop({ type: { gps: Boolean, network: Boolean, _id: false }, default: null })
  checkOutVerification: { gps: boolean; network: boolean } | null;

  @Prop({ default: false })
  mockLocationSuspected: boolean;

  @Prop({ default: false })
  checkOutMockLocationSuspected: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', default: null })
  recordedBy: Types.ObjectId | null;

  @Prop({ default: '' })
  notes: string;

  @Prop({ type: Number, default: null })
  lateMinutes: number | null;

  // ───────────────────────────────────── the lateness, and its account
  //
  // Minutes on their own are an accusation with no reply. The teacher record
  // has had these since the lateness queue was built; a supervisor was late
  // in exactly the same way and had nowhere to say why, so the office saw a
  // number and the person saw nothing at all.

  /** What they said about it. null while nothing has been said. */
  @Prop({ type: String, default: null })
  lateReason: string | null;

  @Prop({ type: Date, default: null })
  lateReasonAt: Date | null;

  /**
   * The school's ruling. null while there is no reason to rule on, and
   * 'pending' from the moment one is written — a reason nobody rules on is a
   * reason nobody reads.
   */
  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: null,
  })
  lateReasonStatus: 'pending' | 'accepted' | 'rejected' | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  lateReasonReviewedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  lateReasonReviewedByName: string;

  @Prop({ type: Date, default: null })
  lateReasonReviewedAt: Date | null;

  /** Why it was accepted or refused — the person is told this. */
  @Prop({ type: String, default: '' })
  lateReasonReviewNote: string;

  @Prop({ type: Number, default: null })
  earlyLeaveMinutes: number | null;

  /**
   * Whether an approved استئذان covers the early departure.
   *
   * `earlyLeaveMinutes` stays a truthful record of the clock; this is what
   * says the school agreed to it. Without the pair, somebody who asked
   * permission and got it reads in the monthly report exactly like somebody
   * who walked out.
   */
  @Prop({ default: false })
  earlyLeaveApproved: boolean;

  /** The "HH:mm" that was approved, for the record. */
  @Prop({ type: String, default: null })
  approvedLeaveAt: string | null;

  @Prop({ type: Number, default: null })
  workMinutes: number | null;

  @Prop({ type: Number, default: null })
  expectedWorkMinutes: number | null;

  @Prop({ default: true })
  isWorkingDay: boolean;

  schoolId?: Types.ObjectId;
}

export const StaffAttendanceSchema =
  SchemaFactory.createForClass(StaffAttendance);
StaffAttendanceSchema.plugin(tenantScopedPlugin);
StaffAttendanceSchema.index(
  { schoolId: 1, staffId: 1, date: 1 },
  { unique: true },
);
StaffAttendanceSchema.index({ schoolId: 1, date: 1 });
// The review queue reads by verdict, newest first.
StaffAttendanceSchema.index({ schoolId: 1, lateReasonStatus: 1, date: -1 });
