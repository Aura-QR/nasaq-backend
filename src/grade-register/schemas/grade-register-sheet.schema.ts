import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ _id: false })
export class RegisterMark {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true })
  studentId: mongoose.Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  score: number;
}
const RegisterMarkSchema = SchemaFactory.createForClass(RegisterMark);

/** A written mark the teacher enters by hand: a worksheet, a research task. */
@Schema()
export class WrittenItem {
  _id: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ type: Number, required: true, min: 1, max: 100 })
  maxScore: number;

  @Prop({ type: [RegisterMarkSchema], default: [] })
  marks: RegisterMark[];
}
const WrittenItemSchema = SchemaFactory.createForClass(WrittenItem);

/**
 * السجل السنوي — one class, one subject offering (so one term).
 *
 * Most of a row is computed live from daily tracking, exams and projects;
 * this holds only what a teacher types (a paper final, extra written marks)
 * and the approval. On approval the computed rows are frozen in `snapshot`,
 * which is what promotion and the student read from then on, and the
 * subject's daily tracking for the class is locked.
 */
@Schema({ collection: 'gradeRegisterSheets', timestamps: true })
export class GradeRegisterSheet extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'SubjectOffering', required: true, index: true })
  subjectOfferingId: mongoose.Types.ObjectId;

  /** Paper end-of-term marks, out of 40. Overrides an electronic final for that student. */
  @Prop({ type: [RegisterMarkSchema], default: [] })
  finalMarks: RegisterMark[];

  @Prop({ type: [WrittenItemSchema], default: [] })
  writtenItems: WrittenItem[];

  @Prop({ type: String, enum: ['draft', 'approved'], default: 'draft' })
  status: 'draft' | 'approved';

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  approvedBy: mongoose.Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  approvedByName: string;

  /** The rows as they stood when approved. */
  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  snapshot: any[] | null;
}

export const GradeRegisterSheetSchema = SchemaFactory.createForClass(GradeRegisterSheet);
GradeRegisterSheetSchema.plugin(tenantScopedPlugin);
GradeRegisterSheetSchema.index({ schoolId: 1, classId: 1, subjectOfferingId: 1 }, { unique: true });
