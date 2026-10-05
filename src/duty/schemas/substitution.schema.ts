import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const COVER_REASONS = ['absent', 'leave', 'other'] as const;
export type CoverReason = (typeof COVER_REASONS)[number];

/**
 * Who can be sent to cover. A teacher, or an administrative assistant
 * (MANAGER) — schools short of free teachers send one of them.
 *
 * Never the principal (SUPERVISOR, مدير المدرسة) or the owner, who run the
 * school rather than take a class, and never STAFF (guards, cleaners).
 */
export const SUBSTITUTE_TYPES = ['Teacher', 'Admin'] as const;
export type SubstituteType = (typeof SUBSTITUTE_TYPES)[number];
export const COVER_ADMIN_ROLES = ['MANAGER'] as const;

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

  /**
   * Who is taking it. Despite the name, this holds an Admin id when
   * `substituteType` is 'Admin'. The name is kept because both clients and
   * every existing row already use it; `substituteType` says which collection.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    refPath: 'substituteType',
    required: true,
    index: true,
  })
  substituteTeacherId: Types.ObjectId;

  /** Rows written before admins could cover have no value, and mean Teacher. */
  @Prop({ type: String, enum: SUBSTITUTE_TYPES, default: 'Teacher' })
  substituteType: SubstituteType;

  /** TEACHER, MANAGER or SUPERVISOR, for labels («مشرفة»). */
  @Prop({ type: String, default: 'TEACHER' })
  substituteRole: string;

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
