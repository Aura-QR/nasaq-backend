import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const OBSERVATION_STATUSES = ['present', 'late', 'absent'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

/**
 * What a supervisor saw when they looked into a classroom.
 *
 * Not the same thing as teacher attendance, which is the day: a teacher can
 * clock in at 06:50 and still reach the fourth period ten minutes late, and
 * the day-level record has no way to say so. This is the period.
 *
 * Nor the same as a substitution, which assigns a replacement. Cover is a
 * decision; this is an observation. Most latenesses need no cover, and cover
 * arranged the day before from an approved leave needs no observation.
 *
 * `present` is recorded too, deliberately. Without it the log answers "who
 * was late" and cannot answer "how much of the school did anyone actually
 * walk past today" — and a round nobody can measure is a round nobody does.
 */
@Schema({ collection: 'lesson_observations', timestamps: true })
export class LessonObservation extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Lecture', required: true, index: true })
  lectureId: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  date: Date;

  /**
   * Who was expected. Nullable because a lecture can be unstaffed — a joint
   * gym session, or a subject whose teacher has not been assigned yet — and
   * "nobody was there" is still worth writing down.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Teacher', default: null, index: true })
  teacherId: Types.ObjectId | null;

  /*
   * Denormalised so the log survives what it describes.
   *
   * A timetable is rebuilt and the lecture is gone; a teacher leaves and the
   * record of their lateness would otherwise read "— was late to —". The log
   * is evidence, and evidence that dissolves when the schedule changes is not
   * evidence.
   */
  @Prop({ type: String, default: '' }) teacherName: string;
  @Prop({ type: String, default: '' }) className: string;
  @Prop({ type: String, default: '' }) subjectName: string;
  @Prop({ type: Number, default: 0 }) slot: number;
  @Prop({ type: String, default: '' }) dayOfWeek: string;

  @Prop({ type: String, enum: OBSERVATION_STATUSES, required: true, index: true })
  status: ObservationStatus;

  /** Only meaningful for 'late'. Null when the supervisor did not count. */
  @Prop({ type: Number, default: null, min: 0, max: 300 })
  lateMinutes: number | null;

  /**
   * The clock time of the round — "we passed at 11:15 and nobody was there".
   *
   * Separate from createdAt: a supervisor writes the round up at the end of
   * the morning, and the minute they typed is not the minute they looked.
   */
  @Prop({ type: Date, default: null })
  observedAt: Date | null;

  @Prop({ type: String, default: '' })
  note: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  recordedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  recordedByName: string;

  // ─────────────────────────────────────── the teacher's answer
  //
  // An observation is one person's account of another's absence, written
  // without them. Recording it and never hearing back makes the log a list of
  // accusations; so the teacher is asked, and the school answers.

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({ type: Date, default: null })
  reasonAt: Date | null;

  /** null while nothing has been said. 'pending' is an answer awaiting a ruling. */
  @Prop({ type: String, enum: ['pending', 'accepted', 'rejected'], default: null })
  reasonStatus: 'pending' | 'accepted' | 'rejected' | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reasonReviewedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  reasonReviewedByName: string;

  @Prop({ type: Date, default: null })
  reasonReviewedAt: Date | null;

  @Prop({ type: String, default: '' })
  reasonReviewNote: string;

  schoolId?: Types.ObjectId;
}

export const LessonObservationSchema =
  SchemaFactory.createForClass(LessonObservation);
LessonObservationSchema.plugin(tenantScopedPlugin);

/*
 * One observation per lesson per day.
 *
 * Two supervisors walk the same corridor and both write down the same empty
 * classroom; without this the teacher is notified twice and the log counts
 * one absence as two. The write path upserts on exactly this.
 */
LessonObservationSchema.index(
  { schoolId: 1, lectureId: 1, date: 1 },
  { unique: true },
);

/** The log, and the teacher's own view of it. */
LessonObservationSchema.index({ schoolId: 1, date: -1, status: 1 });
LessonObservationSchema.index({ schoolId: 1, teacherId: 1, date: -1 });
