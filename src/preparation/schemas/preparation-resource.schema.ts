import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';
import { FILE_REF, FileRefDto } from '../../common/dto/file-ref.dto';
export const RESOURCE_TYPES = [
  'homework',
  'activity',
  'enrichment',
  'quiz',
] as const;
@Schema({ collection: 'preparation_resources', timestamps: true })
export class PreparationResource extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'Preparation', required: true })
  preparationId: Types.ObjectId;
  @Prop({ type: String, required: true, enum: RESOURCE_TYPES }) type: string;
  @Prop({ type: M.Types.ObjectId, ref: 'Exam', default: null })
  examId: Types.ObjectId;
  @Prop({ type: M.Types.ObjectId, ref: 'Project', default: null })
  projectId: Types.ObjectId;
  @Prop({ default: '', trim: true }) title: string;
  @Prop({ default: '' }) description: string;
  @Prop({ type: Date, default: null }) startAt: Date;
  @Prop({ type: Date, default: null }) dueAt: Date;
  @Prop({ type: Number, min: 0, default: null }) totalGrade: number;
  @Prop({ default: '' }) link: string;
  @Prop({ type: [FILE_REF], _id: false, default: [] }) files: FileRefDto[];
}
export const PreparationResourceSchema =
  SchemaFactory.createForClass(PreparationResource);
PreparationResourceSchema.plugin(tenantScopedPlugin);
PreparationResourceSchema.index({ schoolId: 1, preparationId: 1 });
