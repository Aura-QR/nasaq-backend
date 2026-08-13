import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Teacher extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  email: string;

  @Prop({ index: true })
  phoneNumber?: string;

  @Prop()
  qualification?: string;

  @Prop()
  experience?: string;

  @Prop()
  specialization?: string;

  @Prop({ required: true })
  hireDate: Date;

  @Prop()
  address?: string;

  @Prop({ required: true })
  isActive: boolean;

  @Prop({ default: false })
  isInCharge: boolean;

  @Prop({ default: 'TEACHER' })
  role: string;

  // select: false — the bcrypt hash must never leave the server. Without this it
  // was returned by every teacher read (list, findAll, findOne, update).
  // Queries that genuinely need it must ask: .select('+password')
  @Prop({ required: true, select: false })
  password: string;

  @Prop({ select: false })
  otp?: string;

  @Prop({ select: false })
  otpExpiry?: Date;

  @Prop({ default: false })
  isManager: boolean;

  @Prop({ type: [String], default: [] })
  managerPermissions: string[];
}

export const TeacherSchema = SchemaFactory.createForClass(Teacher);
TeacherSchema.plugin(tenantScopedPlugin);

TeacherSchema.index({ schoolId: 1, email: 1 }, { unique: true });