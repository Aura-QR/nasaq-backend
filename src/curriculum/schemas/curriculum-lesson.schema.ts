import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';
@Schema({ collection: 'curriculum_lessons', timestamps: true })
export class CurriculumLesson extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'CurriculumUnit', required: true })
  unitId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, min: 0 }) order: number;
  @Prop({ type: [String], default: [] }) objectives: string[];
  @Prop({ type: M.Types.ObjectId, ref: 'CatalogLesson', default: null })
  catalogLessonId: Types.ObjectId;
}
export const CurriculumLessonSchema =
  SchemaFactory.createForClass(CurriculumLesson);
CurriculumLessonSchema.plugin(tenantScopedPlugin);
CurriculumLessonSchema.index({ schoolId: 1, unitId: 1, order: 1 });
CurriculumLessonSchema.index(
  { schoolId: 1, unitId: 1, catalogLessonId: 1 },
  {
    unique: true,
    partialFilterExpression: { catalogLessonId: { $type: 'objectId' } },
  },
);
