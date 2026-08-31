import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const COVER_REASONS = ['absent', 'leave', 'other'] as const;
export type CoverReason = (typeof COVER_REASONS)[number];

/**
 * One lecture, on one day, taught by somebody other than its usual teacher.
 *
 * Keyed on the lecture and the date rather than replacing the lecture itself:
 * a lecture is a recurring weekly slot for the whole term, and cover is a
 * single day. Editing the timetable to cover one Tuesday would move the class
 * permanently.
 */
@Schema({ collection: 'substitutions', timestamps: true })
export class Substitution extends Document {
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Lecture',
    required: true,
    index: true,
  })
  lectureId: Types.ObjectId;

  /** null when the slot had no teacher assigned in the first place. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    default: null,
    index: true,
  })
  absentTeacherId: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true,
  })
  substituteTeacherId: Types.ObjectId;

  @Prop({ type: String, default: '' })
  absentTeacherName: string;

  @Prop({ type: String, default: '' })
  substituteTeacherName: string;

  @Prop({ type: String, enum: COVER_REASONS, default: 'absent' })
  reason: CoverReason;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  createdBy: Types.ObjectId | null;

  schoolId?: Types.ObjectId;
}

export const SubstitutionSchema = SchemaFactory.createForClass(Substitution);
SubstitutionSchema.plugin(tenantScopedPlugin);

// A lecture on a given day has one cover. Assigning a second is a correction
// of the first, and two people told to take the same room is worse than none.
SubstitutionSchema.index({ schoolId: 1, date: 1, lectureId: 1 }, { unique: true });
// A substitute cannot be in two rooms at once either.
SubstitutionSchema.index(
  { schoolId: 1, date: 1, substituteTeacherId: 1, lectureId: 1 },
  { unique: true },
);
SubstitutionSchema.index({ schoolId: 1, date: 1, substituteTeacherId: 1 });
