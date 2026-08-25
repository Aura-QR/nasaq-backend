import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'busPlans', timestamps: true })
export class BusPlan extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ enum: ['pickup', 'dropoff', 'both'], required: true })
  serviceType: string;

  @Prop({ required: true, min: 0 })
  fee: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'InstallmentPlan', default: null })
  installmentPlanId: mongoose.Types.ObjectId | null;

  @Prop({ default: true })
  isActive: boolean;
}

export const BusPlanSchema = SchemaFactory.createForClass(BusPlan);
BusPlanSchema.plugin(tenantScopedPlugin);

BusPlanSchema.index({ schoolId: 1, isActive: 1 });
