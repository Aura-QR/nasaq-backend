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

  schoolId?: Types.ObjectId;
}

export const TeacherAttendanceSchema = SchemaFactory.createForClass(TeacherAttendance);
TeacherAttendanceSchema.plugin(tenantScopedPlugin);
TeacherAttendanceSchema.index({ schoolId: 1, date: 1 });
TeacherAttendanceSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });
