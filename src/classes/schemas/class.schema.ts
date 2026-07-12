import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { GenderEnum } from '../enums/gender.enum';

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Class extends Document {
  @Prop({ required: true })
  academicYear: string;

  @Prop({ required: true, enum: GenderEnum })
  gender: GenderEnum;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    default: [],
  })
  subjectIds: mongoose.Types.ObjectId[];

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    required: false,
    default: [],
  })
  studentIds?: mongoose.Types.ObjectId[];

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: false,
    default: null
  })
  teacherInChargeId?: mongoose.Types.ObjectId;

  @Prop({ required: true })
  roomNumber: string;

  @Prop({ required: true })
  maxCapacity: number;

  @Prop({ required: true, default: true })
  isActive: boolean;

  // @Prop({ type: Date, required: false })
  // startDate?: Date;

  // @Prop({ type: Date, required: false })
  // endDate?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ClassSchema = SchemaFactory.createForClass(Class);

ClassSchema.virtual('currentEnrollment').get(function() {
  return this.studentIds?.length || 0;
});

ClassSchema.virtual('availableSeats').get(function() {
  const enrolled = this.studentIds?.length || 0;
  return this.maxCapacity - enrolled;
});

