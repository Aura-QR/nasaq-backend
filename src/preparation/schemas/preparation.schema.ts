import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export type PreparationDocument = Preparation & Document;

export const REVIEW_STATUSES = [
  'pending',
  'approved',
  'needs_revision',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

@Schema({ timestamps: true })
export class Preparation {
  @Prop({
    type: MongooseSchema.Types.Mixed,
    ref: 'Lecture',
    required: false,
    default: null,
    index: true
  })
  lecture: MongooseSchema.Types.ObjectId | string;

  @Prop({
    type: MongooseSchema.Types.Mixed,
    ref: 'SubjectOffering',
    required: true,
    index: true
  })
  subject: MongooseSchema.Types.ObjectId | string;

  @Prop({
    type: [
      {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        path: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],
    _id: false,
  })
  files: {
    filename: string;
    originalName: string;
    path: string;
    size: number;
  }[];

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: false,
    default: null,
    index: true
  })
  submittedBy: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: false,
    index: true
  })
  name: string;

  /**
   * The lesson title the teacher types in. There is no curriculum in the
   * system, so this is free text — it is what the teacher wrote at the top of
   * the sheet they printed from Madrasati.
   *
   * Note this is NOT `name`: `name` holds the *teacher's* name (set from
   * `teacherName` on create), which is why searching `?name=` searches
   * teachers. Keeping them apart avoids overloading a field that a client
   * already reads.
   */
  @Prop({ type: String, required: false, default: '', index: true })
  lessonTitle: string;

  /**
   * The Saturday 00:00 UTC that opens the week this preparation belongs to.
   *
   * A lecture is a recurring weekly slot ("sunday, slot 6"), so the teacher
   * only has to pick the week — the actual calendar day is derived from
   * `weekOf + lecture.dayOfWeek`. Storing the week start (rather than a free
   * date) makes "the week's preparations" a single indexed equality match.
   */
  @Prop({ type: Date, required: false, default: null, index: true })
  weekOf: Date;

  /**
   * True for rows backfilled from `createdAt` — the upload time, not the
   * lesson time. Keeps guessed weeks distinguishable from recorded ones.
   */
  @Prop({ type: Boolean, default: false })
  isWeekEstimated: boolean;

  /**
   * Copied off the lecture at write time rather than joined at read time.
   *
   * The Friday cleanup cron (tasks.service.ts) replaces `lecture` with a plain
   * snapshot object, which destroys the ref — so a `$lookup` would find
   * nothing for anything older than the current week. Denormalising is what
   * makes filtering work on both sides of that cron.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Class',
    required: false,
    default: null,
    index: true,
  })
  classId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Term',
    required: false,
    default: null,
    index: true,
  })
  termId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: REVIEW_STATUSES,
    default: 'pending',
    index: true,
  })
  reviewStatus: ReviewStatus;

  /**
   * No `ref`: a reviewer may be a Teacher (promoted to manager), a Manager or
   * the Owner, which live in different collections. The name is stored
   * alongside so the client never has to resolve it.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: false, default: null })
  reviewedBy: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, required: false, default: '' })
  reviewedByName: string;

  @Prop({ type: Date, required: false, default: null })
  reviewedAt: Date;

  @Prop({ type: String, required: false, default: '' })
  reviewNote: string;
}

export const PreparationSchema = SchemaFactory.createForClass(Preparation);
PreparationSchema.plugin(tenantScopedPlugin);

PreparationSchema.index({ schoolId: 1, lecture: 1 });
// The weekly review screen: one teacher's week, or the whole school's week.
PreparationSchema.index({ schoolId: 1, weekOf: 1, submittedBy: 1 });
PreparationSchema.index({ schoolId: 1, weekOf: 1, classId: 1 });
PreparationSchema.index({ schoolId: 1, reviewStatus: 1 });
