import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'installmentPlans', timestamps: true })
export class InstallmentPlan extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 1 })
  numberOfInstallments: number;

  @Prop({ type: [Date], required: true })
  dueDates: Date[];

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  })
  createdBy: mongoose.Types.ObjectId;
}

export const InstallmentPlanSchema = SchemaFactory.createForClass(InstallmentPlan);
InstallmentPlanSchema.plugin(tenantScopedPlugin);

InstallmentPlanSchema.index({ schoolId: 1, createdAt: -1 });
