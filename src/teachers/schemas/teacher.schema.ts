import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

@Schema({ timestamps: true })
export class Teacher extends Document {
  @Prop({ required: true })
  name: string;

  // @Prop({ required: true })
  // lastName: string;

  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ index: true })
  phoneNumber?: string;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    required: true,
    default: []
  })
  subjectIds: mongoose.Types.ObjectId[]; // can teach multiple subjects

  @Prop()
  qualification?: string;

  @Prop()
  experience?: string;

  @Prop()
  specialization?: string;

  @Prop({ required: true })
  hireDate: Date;

  @Prop()
  address?: string;

  @Prop({ required: true })
  isActive: boolean;

  @Prop({ default: false })
  isInCharge: boolean;

  @Prop({ default: 'TEACHER' })
  role: string;

  @Prop({ required: true })
  password: string;
}

export const TeacherSchema = SchemaFactory.createForClass(Teacher);