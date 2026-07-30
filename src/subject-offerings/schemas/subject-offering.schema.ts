import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class SubjectOffering extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Term', required: true, index: true })
  termId: mongoose.Types.ObjectId;
}

export const SubjectOfferingSchema = SchemaFactory.createForClass(SubjectOffering);
SubjectOfferingSchema.plugin(tenantScopedPlugin);
SubjectOfferingSchema.index({ schoolId: 1, subjectId: 1, gradeLevelId: 1, termId: 1 }, { unique: true });
