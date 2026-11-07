import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';

/**
 * Days the school teaches remotely, declared by the administration — like a
 * holiday, but the lessons still happen, online. No `stageIds` means the whole
 * school; otherwise only classes of those stages.
 */
@Schema({ collection: 'remote_days', timestamps: true })
export class RemoteDay extends Document {
  /** Calendar day, UTC midnight. */
  @Prop({ type: Date, required: true })
  startDate: Date;

  /** Inclusive; equal to startDate for one day. */
  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({ type: [Types.ObjectId], ref: 'Stage', default: [] })
  stageIds: Types.ObjectId[];

  @Prop({ default: '', trim: true })
  note: string;

  @Prop({ type: Types.ObjectId, default: null })
  createdBy: Types.ObjectId | null;
}

export const RemoteDaySchema = SchemaFactory.createForClass(RemoteDay);
RemoteDaySchema.plugin(tenantScopedPlugin);
RemoteDaySchema.index({ schoolId: 1, startDate: 1, endDate: 1 });
