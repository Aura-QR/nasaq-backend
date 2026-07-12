import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ collection: 'attendance', timestamps: true })
export class Attendance extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Student',
    index: true
  })
  studentId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Class',
    index: true
  })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ index: true })
  name: string;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);


