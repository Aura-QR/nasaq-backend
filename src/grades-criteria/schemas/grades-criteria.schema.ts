import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'gradesCriteria', timestamps: true })
export class GradesCriteria extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'SubjectOffering',
    index: true,
  })
  subjectOfferingId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  final: number;

  @Prop({ required: true })
  assignments: number;

  @Prop({ required: true, min: 0 })
  assignmentsCount: number;

  @Prop({ required: true })
  activities: number;

  @Prop({ required: true })
  projects: number;

  @Prop({ required: true, min: 0 })
  projectsCount: number;

  @Prop({ required: true })
  quizzes: number;

  @Prop({ required: true, min: 0 })
  quizzesCount: number;

  @Prop({ type: Number, required: false })
  passingGrade?: number;
}

export const GradesCriteriaSchema = SchemaFactory.createForClass(GradesCriteria);
GradesCriteriaSchema.plugin(tenantScopedPlugin);

GradesCriteriaSchema.index({ schoolId: 1, subjectOfferingId: 1 }, { unique: true });
