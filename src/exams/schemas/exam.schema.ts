import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { ExamType } from '../enums/exam-type.enum';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * One question. Its rules per type live in question-rules.util — the
 * schema only stores. A question written before `type` existed has none,
 * and reads as 'mcq'; one with no `marks` shares the exam's grade equally.
 */
@Schema({ _id: true })
export class Question {
  @Prop({ type: String, enum: ['mcq', 'true_false', 'essay'], default: 'mcq' })
  type: 'mcq' | 'true_false' | 'essay';

  @Prop({ required: true })
  question: string;

  // Empty for an essay. A true/false question stores «صح»/«خطأ», so an app
  // that only knows multiple choice still shows and marks it.
  @Prop({ type: [String], default: [] })
  options: string[];

  // null for an essay, which the teacher marks.
  @Prop({ type: String, default: null })
  correctAnswer: string | null;

  /** Essay only. Shown to the teacher while marking; to the student only after it is graded. */
  @Prop({ type: String, default: null, maxlength: 2000 })
  modelAnswer: string | null;

  /** The question's weight. null on old exams → equal share. */
  @Prop({ type: Number, default: null, min: 0.25 })
  marks: number | null;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

@Schema({ collection: 'exams', timestamps: true })
export class Exam extends Document {
  // Internal retry key for an exam generated from a preparation. Not accepted by the public DTO.
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Preparation' })
  generatedFromPreparation?: mongoose.Types.ObjectId;
  // null under the ministry template, which has no «معايير الدرجات».
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    default: null,
    ref: 'GradesCriteria',
    index: true,
  })
  gradesCriteriaId: mongoose.Types.ObjectId | null;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'SubjectOffering',
    index: true,
  })
  subjectOfferingId: mongoose.Types.ObjectId;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    required: true,
    index: true,
  })
  classIds: mongoose.Types.ObjectId[];

  @Prop({ required: true, enum: ExamType })
  examType: ExamType;

  @Prop({ required: true })
  grade: number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true,
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

  /**
   * Set on a makeup exam («اختبار بديل»): the exam it stands in for. Its
   * results count as the original's, so a makeup is never a column, a count
   * or a list row of its own.
   */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null, index: true })
  makeupOf: mongoose.Types.ObjectId | null;

  /** Makeup only: who may see and sit it. Empty on a normal exam (the whole of classIds). */
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }], default: [] })
  studentIds: mongoose.Types.ObjectId[];
}

export const ExamSchema = SchemaFactory.createForClass(Exam);
ExamSchema.plugin(tenantScopedPlugin);

ExamSchema.index({ schoolId: 1, gradesCriteriaId: 1, examType: 1 });
ExamSchema.index({ schoolId: 1, classIds: 1 });
ExamSchema.index({ schoolId: 1, subjectOfferingId: 1 });
ExamSchema.index({ schoolId: 1, createdAt: -1 });
ExamSchema.index({ schoolId: 1, generatedFromPreparation: 1 }, {
  unique: true, partialFilterExpression: { generatedFromPreparation: { $type: 'objectId' } },
});
