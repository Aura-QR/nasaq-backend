import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * سجل المتابعة اليومي — what a teacher observed in one period.
 *
 * Under the flexible grading system this is behavioural only and never
 * reaches the term grade. Under the ministry template it feeds the annual
 * register: participation and homework make the 40 for performance and
 * interaction, and the paper quiz score counts toward written assessments
 * (grade-register). Once that register is approved, the subject's tracking
 * for the class is locked.
 *
 * Attendance is deliberately NOT here. It already lives in the `attendance`
 * collection, where recording an absence notifies the family and opens an
 * excuse the school can accept or refuse. A second copy would be a second
 * answer to "was she here?", and the monthly report would depend on which
 * screen you asked.
 */
@Schema({ collection: 'dailyTracking', timestamps: true })
export class DailyTracking extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: mongoose.Types.ObjectId;

  /**
   * The period, not the class.
   *
   * A student sits several periods a day under different teachers. Keyed on
   * the class, the maths teacher's save would overwrite the science
   * teacher's observation of the same student on the same day.
   */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true, index: true })
  lectureId: mongoose.Types.ObjectId;

  /** Midnight UTC of the school's calendar day — see `todayAtSchool`. */
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  @Prop({ type: Boolean, default: true })
  participation: boolean;

  /**
   * She brought the work and attempted it — an observation, not a mark.
   *
   * Distinct from the graded assignment modules: `exams` (ExamType.ASSIGNMENT,
   * answered on screen and marked automatically) and `projects` (files
   * uploaded and marked by hand). Both of those carry scores and feed
   * `gradesCriteria`. This field carries neither and feeds nothing.
   *
   * It is also not derivable from them: the system knows who submitted a
   * file, and cannot know who brought her notebook to the lesson.
   */
  @Prop({ type: Boolean, default: true })
  homework: boolean;

  /**
   * Three states, not two.
   *
   * `null` — no quiz was held. `false` — there was one and she did not pass
   * it. Collapsing them into a boolean reports failures on days when no quiz
   * existed, which is why this alone defaults to null.
   */
  @Prop({ type: Boolean, default: null })
  quiz: boolean | null;

  /**
   * A paper quiz's mark, typed by the teacher; null — no quiz, or not sat.
   * `quiz` above is kept for app builds that still send a tick: it is
   * derived from the score (half or more) whenever a score is written.
   */
  @Prop({ type: Number, default: null, min: 0 })
  quizScore: number | null;

  /** What `quizScore` is out of — the same for the whole sheet. */
  @Prop({ type: Number, default: null, min: 1 })
  quizMaxScore: number | null;

  // ───────────────────────────────────── denormalised on purpose
  //
  // The monthly report is read long after the fact, by which time a timetable
  // may have been rebuilt or a teacher may have left. A record that dissolves
  // when the schedule changes is not a record.

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'SubjectOffering', default: null, index: true })
  subjectOfferingId: mongoose.Types.ObjectId | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null, index: true })
  teacherId: mongoose.Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  subjectName: string;

  @Prop({ type: String, default: '' })
  className: string;

  /** Who last wrote this row. A disputed record otherwise has no author. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  recordedBy: mongoose.Types.ObjectId | null;
}

export const DailyTrackingSchema = SchemaFactory.createForClass(DailyTracking);
DailyTrackingSchema.plugin(tenantScopedPlugin);

// Re-saving a sheet updates it rather than doubling it. The teacher who
// corrects one tick and saves again must not create a second row.
DailyTrackingSchema.index(
  { schoolId: 1, studentId: 1, lectureId: 1, date: 1 },
  { unique: true },
);

// The monthly report, both ways it is read.
DailyTrackingSchema.index({ schoolId: 1, classId: 1, date: 1 });
DailyTrackingSchema.index({ schoolId: 1, studentId: 1, date: 1 });
