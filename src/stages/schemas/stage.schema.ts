import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Stage extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  order: number;
}

export const StageSchema = SchemaFactory.createForClass(Stage);
StageSchema.plugin(tenantScopedPlugin);
StageSchema.index({ schoolId: 1, name: 1 }, { unique: true });
StageSchema.index({ schoolId: 1, order: 1 });
