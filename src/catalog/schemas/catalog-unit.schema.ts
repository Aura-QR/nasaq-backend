import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';

@Schema({ collection: 'catalog_units', timestamps: true })
export class CatalogUnit extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'CatalogSubject', required: true })
  catalogSubjectId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, min: 0 }) order: number;
  @Prop({ required: true, unique: true }) sourceId: string;
}
export const CatalogUnitSchema = SchemaFactory.createForClass(CatalogUnit);
CatalogUnitSchema.index({ catalogSubjectId: 1, order: 1 });
