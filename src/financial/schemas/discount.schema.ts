import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'discounts', timestamps: true })
export class Discount extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  percentage: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
DiscountSchema.plugin(tenantScopedPlugin);

DiscountSchema.index({ schoolId: 1, isActive: 1 });
