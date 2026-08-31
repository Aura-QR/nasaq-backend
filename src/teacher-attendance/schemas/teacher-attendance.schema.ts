import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'teacherAttendance', timestamps: true })
export class TeacherAttendance extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Teacher', index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Date, required: true })
  checkInAt: Date;

  @Prop({ required: true, enum: ['location', 'manual'], default: 'location' })
  method: string;

  @Prop({ type: { lat: Number, lng: Number }, default: null })
  coordinates: { lat: number; lng: number } | null;

  @Prop({ default: null })
  distanceMeters: number | null;

  @Prop({ type: { gps: Boolean, network: Boolean }, default: () => ({ gps: false, network: false }) })
  verification: { gps: boolean; network: boolean };

  @Prop({ default: false })
  mockLocationSuspected: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  recordedBy: Types.ObjectId | null;

  @Prop()
  notes: string;

  @Prop({ index: true })
  name: string;

  // ── Check-out ──────────────────────────────────────────────────────────
  // All optional with default null, so every record written before this
  // existed stays valid and no migration is needed.

  @Prop({ type: Date, default: null })
  checkOutAt: Date | null;

  @Prop({ type: String, enum: ['location', 'manual'], default: null })
  checkOutMethod: string | null;

  @Prop({ type: { lat: Number, lng: Number }, default: null })
  checkOutCoordinates: { lat: number; lng: number } | null;

  @Prop({ type: Number, default: null })
  checkOutDistanceMeters: number | null;

  @Prop({ type: { gps: Boolean, network: Boolean }, default: null })
  checkOutVerification: { gps: boolean; network: boolean } | null;

  @Prop({ default: false })
  checkOutMockLocationSuspected: boolean;

  /**
   * Snapshotted, not recomputed on read — the same reasoning as
   * DiscountSnapshot in the financial module. Changing workStartTime in March
   * must not silently rewrite who was late in October.
   *
   * null means the school had no workStartTime when this was recorded:
   * unknown, which is not the same as zero.
   */
  @Prop({ type: Number, default: null })
  lateMinutes: number | null;

  /** null until a check-out exists. */
  @Prop({ type: Number, default: null })
  workMinutes: number | null;

  /**
   * Minutes short of the day's official end. The mirror of lateMinutes, and
   * snapshotted for the same reason.
   *
   * null = the day had no end time configured, which is not the same as
   * leaving exactly on time.
   */
  @Prop({ type: Number, default: null })
  earlyLeaveMinutes: number | null;

  /**
   * An approved استئذان for this day, snapshotted at check-out.
   *
   * earlyLeaveMinutes stays a truthful record of the clock; this is what says
   * the departure was sanctioned. Keeping them apart means a report can show
   * "left 90 minutes early, approved" rather than having to choose between
   * hiding the fact and implying a fault.
   */
  @Prop({ type: Boolean, default: false })
  earlyLeaveApproved: boolean;

  /** The time the approval was for, "HH:mm". null when there was none. */
  @Prop({ type: String, default: null })
  approvedLeaveAt: string | null;

  /**
   * How long this day was meant to be, from the school's schedule. Stored so a
   * report can say "worked 340 of an expected 390" — workMinutes on its own is
   * a raw number with nothing to compare it against.
   */
  @Prop({ type: Number, default: null })
  expectedWorkMinutes: number | null;

  /**
   * Was this a working day for the school? Attendance on a day off is allowed
   * and recorded, it just has no hours to be measured against, and it is
   * counted separately in the summary rather than skewing the averages.
   */
  @Prop({ default: true })
  isWorkingDay: boolean;

  schoolId?: Types.ObjectId;
}

export const TeacherAttendanceSchema = SchemaFactory.createForClass(TeacherAttendance);
TeacherAttendanceSchema.plugin(tenantScopedPlugin);
TeacherAttendanceSchema.index({ schoolId: 1, date: 1 });
TeacherAttendanceSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });
