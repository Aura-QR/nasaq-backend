import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'financialTrips', timestamps: true })
export class FinancialTrip extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  fee: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const FinancialTripSchema = SchemaFactory.createForClass(FinancialTrip);
FinancialTripSchema.plugin(tenantScopedPlugin);

FinancialTripSchema.index({ schoolId: 1, isActive: 1 });
