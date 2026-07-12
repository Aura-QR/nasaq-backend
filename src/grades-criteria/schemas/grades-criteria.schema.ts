import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ collection: 'gradesCriteria', timestamps: true })
export class GradesCriteria extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Subject',
    index: true
  })
  subjectId: mongoose.Types.ObjectId;

  @Prop({required: true})
  academicYear : string;

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

