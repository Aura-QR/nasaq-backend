import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

export enum AdditionalFeeTarget {
  STUDENT = 'student',
  CLASS = 'class',
  ACADEMIC_YEAR = 'academicYear',
  SCHOOL = 'school',
}

@Schema({ collection: 'additionalFees', timestamps: true })
export class AdditionalFee extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, enum: AdditionalFeeTarget })
  targetType: AdditionalFeeTarget;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  targetId: mongoose.Types.ObjectId | null;

  @Prop({ default: null })
  targetAcademicYear: string | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const AdditionalFeeSchema = SchemaFactory.createForClass(AdditionalFee);
