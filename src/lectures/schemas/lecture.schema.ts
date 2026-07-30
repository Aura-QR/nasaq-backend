import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { DayOfWeek } from '../enums/day-of-week.enum';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export type LectureDocument = Lecture & Document;

@Schema({ timestamps: true })
export class Lecture {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true,
  })
  classId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'SubjectOffering',
    required: true,
    index: true,
  })
  subjectOfferingId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Term',
    required: true,
    index: true,
  })
  termId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Teacher',
    required: false,
    default: null,
    index: true,
  })
  teacherId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DayOfWeek),
    index: true,
  })
  dayOfWeek: DayOfWeek;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 10,
    index: true,
  })
  slot: number;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Preparation' }],
    default: [],
  })
  preparation: MongooseSchema.Types.ObjectId[];
}

export const LectureSchema = SchemaFactory.createForClass(Lecture);
LectureSchema.plugin(tenantScopedPlugin);

// Unique slot per class per term
LectureSchema.index(
  { schoolId: 1, classId: 1, dayOfWeek: 1, slot: 1, termId: 1 },
  { unique: true },
);

// Partial unique slot per teacher per term (skips null teacherId for "needs teacher" state)
LectureSchema.index(
  { schoolId: 1, teacherId: 1, dayOfWeek: 1, slot: 1, termId: 1 },
  {
    unique: true,
    partialFilterExpression: { teacherId: { $ne: null } },
  },
);
