import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Subject extends Document {
  @Prop({ required: true })
  subjectName: string;

  @Prop({ required: false })
  subjectCode?: string;

  @Prop({ default: true })
  isRequiredForPromotion: boolean;
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.plugin(tenantScopedPlugin);

SubjectSchema.index({ schoolId: 1, subjectName: 1 });