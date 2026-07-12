import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ collection: 'examResults', timestamps: true })
export class ExamResult extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Exam',
    index: true,
  })
  examId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Student',
    index: true,
  })
  studentId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  startedAt: Date;

  @Prop({ default: false })
  submitted: boolean;

  @Prop()
  achievedGrade: number;

  @Prop()
  percentage: number;

  @Prop()
  passed: boolean;
}

export const ExamResultSchema = SchemaFactory.createForClass(ExamResult);

// One session per student per exam
ExamResultSchema.index({ examId: 1, studentId: 1 }, { unique: true });
