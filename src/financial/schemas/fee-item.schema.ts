import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * Something the school sells by the piece, priced in the settings: a uniform
 * at 150 riyals, two for 300. A sale charges the student unit price ×
 * quantity, at the price of the day; changing the price later changes only
 * future sales.
 */
@Schema({ collection: 'fee_items', timestamps: true })
export class FeeItem extends Document {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true, min: 0 })
  unitPrice: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null })
  createdBy: mongoose.Types.ObjectId | null;
}

export const FeeItemSchema = SchemaFactory.createForClass(FeeItem);
FeeItemSchema.plugin(tenantScopedPlugin);
FeeItemSchema.index({ schoolId: 1, name: 1 }, { unique: true });
