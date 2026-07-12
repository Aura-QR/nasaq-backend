import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

@Schema({ timestamps: true })
export class Library extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  link: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: false,
    default: null,
  })
  subjectId?: mongoose.Types.ObjectId; // Optional: can be connected to a subject

  @Prop({ required: false })
  academicYear?: string; // Optional: academic year (e.g., "2024-2025")
}

export const LibrarySchema = SchemaFactory.createForClass(Library);
