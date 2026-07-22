import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Teacher extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  email: string;

  @Prop({ index: true })
  phoneNumber?: string;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    required: true,
    default: []
  })
  subjectIds: mongoose.Types.ObjectId[];

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

  @Prop({ required: true })
  password: string;

  // Multi-tenant extension for Teacher promotion to Manager
  @Prop({ default: false })
  isManager: boolean;

  @Prop({ type: [String], default: [] })
  managerPermissions: string[];
}

export const TeacherSchema = SchemaFactory.createForClass(Teacher);
TeacherSchema.plugin(tenantScopedPlugin);

// Compound unique email scoped by schoolId
TeacherSchema.index({ schoolId: 1, email: 1 }, { unique: true });