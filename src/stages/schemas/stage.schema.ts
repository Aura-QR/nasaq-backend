import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Stage extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  order: number;

  // ───────────────────────────────────────── the stage's own school day
  //
  // A kindergarten does not run a shorter version of the primary day. It runs
  // twelve to fourteen periods of about half an hour, and among them a morning
  // meeting, a snack and play. Before these, the number of periods was one
  // setting for the whole school, so giving KG its fourteen would have given
  // them to the primary and middle stages too.
  //
  // Every field is null by default, and null means "use the school's value".
  // Nothing already stored changes, and no migration is needed.

  /**
   * Periods in this stage's day.
   *
   * null — the default — falls back to `school.settings.periodsPerDay`. A
   * single day inside `workSchedule` still overrides this, so the order is:
   * that day, then this, then the school.
   */
  @Prop({ type: Number, default: null, min: 1, max: 20 })
  periodsPerDay: number | null;

  /** HH:mm. When this stage starts later or finishes earlier than the school. */
  @Prop({ type: String, default: null })
  startTime: string | null;

  @Prop({ type: String, default: null })
  endTime: string | null;

  /**
   * How long one period runs, in minutes — 30 for a kindergarten, 45 for a
   * primary.
   *
   * Recorded for the timetable to display and for a school to reason about
   * its day. It is NOT used to detect collisions: a lecture still carries a
   * slot number rather than a real clock time, so period 3 in KG and period 3
   * in primary are treated as the same moment even when they are not. Keep
   * kindergarten teachers off primary classes until a lecture knows its own
   * time.
   */
  @Prop({ type: Number, default: null, min: 5, max: 120 })
  periodMinutes: number | null;
}

export const StageSchema = SchemaFactory.createForClass(Stage);
StageSchema.plugin(tenantScopedPlugin);
StageSchema.index({ schoolId: 1, name: 1 }, { unique: true });
StageSchema.index({ schoolId: 1, order: 1 });
