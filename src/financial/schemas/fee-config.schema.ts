import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'feeConfigs', timestamps: true })
export class FeeConfig extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: mongoose.Types.ObjectId;

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

FeeConfigSchema.index({ schoolId: 1, academicYearId: 1, gradeLevelId: 1 }, { unique: true });
