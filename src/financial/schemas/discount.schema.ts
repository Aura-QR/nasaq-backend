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

  /** percentage of the fee, or a fixed amount in riyals. */
  @Prop({ enum: ['percentage', 'fixed'], default: 'percentage' })
  type: string;

  /** For a percentage discount. 0 on a fixed one. */
  @Prop({ required: true, min: 0, default: 0 })
  percentage: number;

  /** For a fixed discount, riyals off. */
  @Prop({ type: Number, min: 0, default: null })
  amount: number | null;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
DiscountSchema.plugin(tenantScopedPlugin);

DiscountSchema.index({ schoolId: 1, isActive: 1 });
