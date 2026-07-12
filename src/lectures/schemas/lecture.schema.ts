import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { DayOfWeek } from '../enums/day-of-week.enum';

export type LectureDocument = Lecture & Document;

@Schema({ timestamps: true })
export class Lecture {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  })
  classId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true
  })
  subjectId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  })
  teacherId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DayOfWeek),
    index: true
  })
  dayOfWeek: DayOfWeek;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 10,
    index: true
  })
  slot: number;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Preparation' }],
    default: []
  })
  preparation: MongooseSchema.Types.ObjectId[];
}

export const LectureSchema = SchemaFactory.createForClass(Lecture);


