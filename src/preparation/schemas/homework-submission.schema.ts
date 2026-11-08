import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';

export const SUBMISSION_STATUSES = ['submitted', 'accepted', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** One uploaded page: a photo of the notebook, or a PDF. */
export class SubmissionFile {
  name: string;
  url: string;
  path: string;
  size: number;
  mimetype: string;
  /** sha256 of the bytes, for spotting the same photo handed in twice. */
  hash: string;
}

/**
 * A student's answer to one lesson homework.
 *
 * Lesson homework (a `homework` resource on a preparation) was read-only: the
 * student read it on «واجباتي» and did it in her notebook, and only the
 * teacher looking at that notebook in class could tell it was done. On a
 * remote day nobody looks at the notebook. This lets the student photograph
 * the pages and hand them in, and the teacher accept them or return them with
 * a note.
 *
 * It carries no mark. Homework reaches the ministry register through the
 * «واجب» tick on the daily-tracking sheet, and the teacher still sets that
 * tick; this is the evidence she sets it from.
 */
@Schema({ collection: 'homework_submissions', timestamps: true })
export class HomeworkSubmission extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'PreparationResource', required: true })
  resourceId: Types.ObjectId;

  @Prop({ type: M.Types.ObjectId, ref: 'Preparation', required: true })
  preparationId: Types.ObjectId;

  @Prop({ type: M.Types.ObjectId, ref: 'Class', default: null })
  classId: Types.ObjectId | null;

  @Prop({ type: M.Types.ObjectId, ref: 'Student', required: true })
  studentId: Types.ObjectId;

  @Prop({
    type: [{ name: String, url: String, path: String, size: Number, mimetype: String, hash: String }],
    _id: false,
    default: [],
  })
  files: SubmissionFile[];

  /** What the student wrote alongside, if anything. */
  @Prop({ default: '', trim: true, maxlength: 500 })
  note: string;

  @Prop({ type: String, enum: SUBMISSION_STATUSES, default: 'submitted' })
  status: SubmissionStatus;

  /** The teacher's note, shown to the student. */
  @Prop({ default: '', trim: true, maxlength: 500 })
  feedback: string;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  /** Handed in after the due day. */
  @Prop({ default: false })
  late: boolean;

  @Prop({ type: M.Types.ObjectId, default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;
}

export const HomeworkSubmissionSchema = SchemaFactory.createForClass(HomeworkSubmission);
HomeworkSubmissionSchema.plugin(tenantScopedPlugin);
HomeworkSubmissionSchema.index({ schoolId: 1, resourceId: 1, studentId: 1 }, { unique: true });
HomeworkSubmissionSchema.index({ schoolId: 1, studentId: 1 });
HomeworkSubmissionSchema.index({ schoolId: 1, 'files.hash': 1 });
