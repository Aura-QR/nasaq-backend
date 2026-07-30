import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class GradeLevel extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Stage', required: true, index: true })
  stageId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  order: number;
}

export const GradeLevelSchema = SchemaFactory.createForClass(GradeLevel);
GradeLevelSchema.plugin(tenantScopedPlugin);
GradeLevelSchema.index({ schoolId: 1, name: 1 }, { unique: true });
GradeLevelSchema.index({ schoolId: 1, stageId: 1, order: 1 });
GradeLevelSchema.index({ schoolId: 1, order: 1 });
