import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Enrollment extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({
    required: true,
    enum: ['active', 'withdrawn', 'transferred', 'graduated'],
    default: 'active',
  })
  status: string;

  @Prop({ default: Date.now })
  enrolledAt: Date;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
EnrollmentSchema.plugin(tenantScopedPlugin);
EnrollmentSchema.index({ schoolId: 1, studentId: 1, academicYearId: 1 }, { unique: true });
EnrollmentSchema.index({ schoolId: 1, classId: 1, academicYearId: 1 });
