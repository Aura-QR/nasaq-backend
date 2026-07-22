import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Subject extends Document {
  @Prop({ required: true })
  subjectName: string;

  @Prop({ required: false })
  subjectCode?: string;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    default: [],
  })
  classIds: mongoose.Types.ObjectId[];
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.plugin(tenantScopedPlugin);

SubjectSchema.index({ schoolId: 1, classIds: 1 });