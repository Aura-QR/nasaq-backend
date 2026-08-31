import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * Who is on supervision duty for a given day (المشرف اليومي).
 *
 * One document per day holding a list, rather than one document per
 * supervisor: the question asked is always "who is on duty today", and some
 * days carry two. Setting the day replaces the list, so the roster cannot
 * drift into half-updated state.
 */
@Schema({ collection: 'dutySupervisors', timestamps: true })
export class DutySupervisor extends Document {
  @Prop({ type: Date, required: true, index: true })
  date: Date;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Teacher' }],
    default: [],
  })
  teacherIds: Types.ObjectId[];

  /** Denormalised alongside the ids, so a roster renders without populating. */
  @Prop({ type: [String], default: [] })
  teacherNames: string[];

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  setBy: Types.ObjectId | null;

  schoolId?: Types.ObjectId;
}

export const DutySupervisorSchema =
  SchemaFactory.createForClass(DutySupervisor);
DutySupervisorSchema.plugin(tenantScopedPlugin);

DutySupervisorSchema.index({ schoolId: 1, date: 1 }, { unique: true });
