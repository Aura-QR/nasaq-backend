import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

@Schema({ timestamps: true })
export class Student extends Document {
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  familyName: string;

  @Prop({ required: true })
  fatherName: string;

  @Prop({ required: true })
  birthDate: Date;

  @Prop({ required: true, enum: ['male', 'female'] })
  gender: string;

  @Prop({ required: true })
  nationality: string;

  @Prop({ required: true })
  academicYear: string;

  @Prop({ required: true, index: true })
  phoneNumber: string;

  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ required: true })
  address: string;

  @Prop()
  previousSchool: string;

  @Prop({ default: Date.now })
  registrationDate: Date;

  @Prop()
  notes: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null,
  })
  classId?: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InstallmentPlan',
    default: null,
  })
  installmentPlanId?: mongoose.Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ index: true })
  name: string;

  @Prop({ unique: true, index: true })
  schoolEmail: string;

  @Prop({ default: 'STUDENT' })
  role: string;

  @Prop({ select: false })
  password: string;

  @Prop({ default: false })
  hasPassword: boolean;

  @Prop({ select: false })
  otp: string;

  @Prop({ select: false })
  otpExpiry: Date;
}

export const StudentSchema = SchemaFactory.createForClass(Student);


StudentSchema.pre('save', function(next) {
  this.name = `${this.firstName} ${this.fatherName} ${this.familyName}`;
  next();
});


StudentSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate() as any;
  if (update.firstName || update.fatherName || update.familyName || 
      update.$set?.firstName || update.$set?.fatherName || update.$set?.familyName) {
    
    const docToUpdate = await this.model.findOne(this.getQuery());
    
    const firstName = update.firstName || update.$set?.firstName || docToUpdate?.firstName;
    const fatherName = update.fatherName || update.$set?.fatherName || docToUpdate?.fatherName;
    const familyName = update.familyName || update.$set?.familyName || docToUpdate?.familyName;
    
    if (!update.$set) update.$set = {};
    update.$set.name = `${firstName} ${fatherName} ${familyName}`;
  }
  next();
});