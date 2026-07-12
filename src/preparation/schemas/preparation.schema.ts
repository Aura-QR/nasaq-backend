import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type PreparationDocument = Preparation & Document;

@Schema({ timestamps: true })
export class Preparation {
  @Prop({
    type: MongooseSchema.Types.Mixed,
    ref: 'Lecture',
    required: false,
    default: null,
    index: true
  })
  lecture: MongooseSchema.Types.ObjectId | string;

  @Prop({
    type: MongooseSchema.Types.Mixed,
    ref: 'Subject',
    required: true,
    index: true
  })
  subject: MongooseSchema.Types.ObjectId | string;

  @Prop({
    type: [
      {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        path: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],
    _id: false,
  })
  files: {
    filename: string;
    originalName: string;
    path: string;
    size: number;
  }[];

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: false,
    default: null,
    index: true
  })
  submittedBy: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: false,
    index: true
  })
  name: string;
}

export const PreparationSchema = SchemaFactory.createForClass(Preparation);
