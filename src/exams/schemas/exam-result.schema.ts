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

  /**
   * 'pending_review' while an essay answer waits for the teacher: the paper
   * has no grade yet (achievedGrade, percentage and passed are null), and
   * the register does not count it at all. Old rows have none: graded.
   */
  @Prop({ type: String, enum: ['graded', 'pending_review'], default: 'graded' })
  status: 'graded' | 'pending_review';

  @Prop({ type: Number })
  achievedGrade: number | null;

  @Prop({ type: Number })
  percentage: number | null;

  @Prop({ type: Boolean })
  passed: boolean | null;

  /**
   * What the student actually answered, kept so the result can be read back.
   *
   * Grading returned the answer-by-answer breakdown and then threw it away,
   * so the only moment a student could ever see which questions they got
   * wrong was the second the paper was submitted. Rows written before this
   * existed have an empty array — the score is still there.
   */
  @Prop({
    type: [
      {
        _id: false,
        questionId: String,
        studentAnswer: String,
        correctAnswer: String,
        isCorrect: Boolean,
        // Written for every question since question types; old rows lack
        // these, and an unanswered question had no entry at all.
        type: { type: String, enum: ['mcq', 'true_false', 'essay'] },
        marks: Number,
        // null: an essay answer the teacher has not marked yet. No default:
        // an old row loaded from the database must not read as unmarked.
        earned: { type: Number },
        feedback: { type: String, default: null, maxlength: 1000 },
        gradedAt: { type: Date, default: null },
        gradedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
      },
    ],
    default: [],
  })
  answers: {
    questionId: string;
    studentAnswer: string;
    correctAnswer: string | null;
    isCorrect: boolean | null;
    type?: 'mcq' | 'true_false' | 'essay';
    marks?: number;
    earned?: number | null;
    feedback?: string | null;
    gradedAt?: Date | null;
    gradedBy?: mongoose.Types.ObjectId | null;
  }[];

  /**
   * Answers saved while the paper is still open (PUT /exams/:id/answers).
   *
   * A student whose app closed, or whose connection dropped, never submitted,
   * and a paper never submitted was a zero with nothing to mark. When her time
   * runs out the paper is marked from what was saved here instead.
   */
  @Prop({ type: [{ _id: false, questionId: String, answer: String }], default: [] })
  draftAnswers: { questionId: string; answer: string }[];

  /** Marked by the server when time ran out, not handed in by the student. */
  @Prop({ type: Boolean, default: false })
  autoSubmitted: boolean;
}

export const ExamResultSchema = SchemaFactory.createForClass(ExamResult);

// One session per student per exam
ExamResultSchema.index({ examId: 1, studentId: 1 }, { unique: true });
