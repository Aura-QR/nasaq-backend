import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'gradesCriteria', timestamps: true })
export class GradesCriteria extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Subject',
    index: true,
  })
  subjectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicYear',
    required: true,
    index: true,
  })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  final: number;

  @Prop({ required: true })
  assignments: number;

  @Prop({ required: true, min: 1 })
  assignmentsCount: number;

  @Prop({ required: true })
  activities: number;

  @Prop({ required: true })
  projects: number;

  @Prop({ required: true, min: 1 })
  projectsCount: number;

  @Prop({ required: true })
  quizzes: number;

  @Prop({ required: true, min: 1 })
  quizzesCount: number;
}
export const GradesCriteriaSchema = SchemaFactory.createForClass(GradesCriteria);
GradesCriteriaSchema.plugin(tenantScopedPlugin);

GradesCriteriaSchema.index({ schoolId: 1, subjectId: 1, academicYearId: 1 }, { unique: true });
