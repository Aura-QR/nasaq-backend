import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { GenderEnum } from '../enums/gender.enum';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Class extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({ required: true, enum: GenderEnum })
  gender: GenderEnum;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: false,
    default: null,
  })
  teacherInChargeId?: mongoose.Types.ObjectId;

  @Prop({ required: false })
  roomNumber?: string;

  @Prop({ required: true })
  maxCapacity: number;

  @Prop({ required: true, default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ClassSchema = SchemaFactory.createForClass(Class);
ClassSchema.plugin(tenantScopedPlugin);

ClassSchema.index({ schoolId: 1, academicYearId: 1, gradeLevelId: 1 });
ClassSchema.index({ schoolId: 1, academicYearId: 1, name: 1 }, { unique: true });
ClassSchema.index({ schoolId: 1, createdAt: -1 });
ClassSchema.index({ schoolId: 1, teacherInChargeId: 1 });
