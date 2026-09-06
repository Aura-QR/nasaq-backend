import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'catalog_subjects', timestamps: true })
export class CatalogSubject extends Document {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, unique: true }) sourceId: string;
}
export const CatalogSubjectSchema =
  SchemaFactory.createForClass(CatalogSubject);
