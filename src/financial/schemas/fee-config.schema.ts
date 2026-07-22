import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'feeConfigs', timestamps: true })
export class FeeConfig extends Document {
  @Prop({ required: true, index: true })
  academicYear: string;

  @Prop({ required: true, min: 0 })
  tuitionFee: number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
  })
  createdBy: mongoose.Types.ObjectId;
}

export const FeeConfigSchema = SchemaFactory.createForClass(FeeConfig);
FeeConfigSchema.plugin(tenantScopedPlugin);

FeeConfigSchema.index({ schoolId: 1, academicYear: 1 }, { unique: true });
