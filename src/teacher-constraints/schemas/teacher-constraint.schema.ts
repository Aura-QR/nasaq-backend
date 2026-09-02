import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * One block of time a teacher cannot be scheduled.
 *
 * An empty `slots` means the whole day. Naming specific slots is how "not the
 * last period" is expressed — the school says which periods those are, since
 * a seven-period day and a five-period day disagree about which one is last.
 */
@Schema({ _id: false })
export class UnavailableBlock {
  @Prop({ type: String, enum: WEEKDAYS, required: true })
  day: Weekday;

  @Prop({ type: [Number], default: [] })
  slots: number[];
}
export const UnavailableBlockSchema = SchemaFactory.createForClass(UnavailableBlock);

/**
 * When a teacher may not be scheduled, for one term.
 *
 * Per term rather than per teacher: a teacher's commitments change between
 * terms, and a constraint that quietly outlives the term it was written for
 * would silently shrink next term's timetable with nothing to point at.
 *
 * Absence of a row means no restriction — the common case costs nothing.
 */
@Schema({ collection: 'teacher_constraints', timestamps: true })
export class TeacherConstraint extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Term', required: true, index: true })
  termId: Types.ObjectId;

  @Prop({ type: [UnavailableBlockSchema], default: [] })
  unavailable: UnavailableBlock[];

  /** Free text for whoever reads the timetable later and wonders why. */
  @Prop({ type: String, default: '' })
  note: string;

  schoolId?: Types.ObjectId;
}

export const TeacherConstraintSchema = SchemaFactory.createForClass(TeacherConstraint);
TeacherConstraintSchema.plugin(tenantScopedPlugin);

// One row per teacher per term — the write path upserts on exactly this.
TeacherConstraintSchema.index(
  { schoolId: 1, teacherId: 1, termId: 1 },
  { unique: true },
);
