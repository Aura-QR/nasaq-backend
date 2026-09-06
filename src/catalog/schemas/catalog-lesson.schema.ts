import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';

@Schema({ collection: 'catalog_lessons', timestamps: true })
export class CatalogLesson extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'CatalogUnit', required: true })
  catalogUnitId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, min: 0 }) order: number;
  @Prop({ required: true, unique: true }) sourceId: string;
}
export const CatalogLessonSchema = SchemaFactory.createForClass(CatalogLesson);
CatalogLessonSchema.index({ catalogUnitId: 1, order: 1 });
