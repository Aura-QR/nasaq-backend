
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { ExamType } from '../enums/exam-type.enum';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ _id: true })
export class Question {
  @Prop({ required: true })
  question: string;

  @Prop({ type: [String], required: true })
  options: string[];

  @Prop({ required: true })
  correctAnswer: string;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

@Schema({ collection: 'exams', timestamps: true })
export class Exam extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'GradesCriteria',
    index: true
  })
  gradesCriteriaId: mongoose.Types.ObjectId;

   @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Subject',
    index: true
  })
  subjectId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  academicYear: string;


  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    required: true,
    index: true
  })
  classIds: mongoose.Types.ObjectId[];

  @Prop({ required: true, enum: ExamType })
  examType: ExamType;

  @Prop({ required: true })
  grade : number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true
  })
  createdBy: mongoose.Types.ObjectId;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, min: 1 })
  duration: number; // in minutes

  @Prop({ type: [QuestionSchema], required: true })
  questions: Question[];
}

export const ExamSchema = SchemaFactory.createForClass(Exam);
ExamSchema.plugin(tenantScopedPlugin);

ExamSchema.index({ schoolId: 1, gradesCriteriaId: 1, examType: 1 });
ExamSchema.index({ schoolId: 1, classIds: 1 });
ExamSchema.index({ schoolId: 1, subjectId: 1 });
ExamSchema.index({ schoolId: 1, createdAt: -1 });