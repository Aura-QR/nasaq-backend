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

  @Prop({ type: Number, default: null })
  earlyLeaveMinutes: number | null;

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
