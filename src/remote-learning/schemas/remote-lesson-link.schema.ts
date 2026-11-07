import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';

/**
 * A meeting link for one lesson on one day, overriding the teacher's standing
 * link — a different room for a test, a co-taught period.
 */
@Schema({ collection: 'remote_lesson_links', timestamps: true })
export class RemoteLessonLink extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Lecture', required: true })
  lectureId: Types.ObjectId;

  /** Calendar day, UTC midnight. */
  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ required: true, trim: true })
  joinUrl: string;

  @Prop({ type: Types.ObjectId, default: null })
  setBy: Types.ObjectId | null;
}

export const RemoteLessonLinkSchema = SchemaFactory.createForClass(RemoteLessonLink);
RemoteLessonLinkSchema.plugin(tenantScopedPlugin);
RemoteLessonLinkSchema.index({ schoolId: 1, lectureId: 1, date: 1 }, { unique: true });
