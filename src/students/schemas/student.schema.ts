import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

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

  @Prop({ required: false })
  nationality?: string;

  @Prop({ required: false, index: true })
  nationalityCode?: string;

  @Prop({ required: true, index: true })
  phoneNumber: string;

  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true })
  address: string;

  @Prop()
  previousSchool: string;

  @Prop({ default: Date.now })
  registrationDate: Date;

  @Prop()
  notes: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ index: true })
  name: string;

  @Prop({ index: true })
  schoolEmail: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: false, default: null, index: true })
  classId?: mongoose.Types.ObjectId;

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
StudentSchema.plugin(tenantScopedPlugin);

// Compound unique indexes scoped by schoolId
StudentSchema.index({ schoolId: 1, email: 1 }, { unique: true });
StudentSchema.index(
  { schoolId: 1, schoolEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { schoolEmail: { $exists: true, $type: 'string' } },
  },
);

StudentSchema.pre('save', function (next) {
  this.name = `${this.firstName} ${this.fatherName} ${this.familyName}`;
  next();
});

StudentSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() as any;
  if (
    update.firstName ||
    update.fatherName ||
    update.familyName ||
    update.$set?.firstName ||
    update.$set?.fatherName ||
    update.$set?.familyName
  ) {
    const docToUpdate = await this.model.findOne(this.getQuery());

    const firstName = update.firstName || update.$set?.firstName || docToUpdate?.firstName;
    const fatherName = update.fatherName || update.$set?.fatherName || docToUpdate?.fatherName;
    const familyName = update.familyName || update.$set?.familyName || docToUpdate?.familyName;

    if (!update.$set) update.$set = {};
    update.$set.name = `${firstName} ${fatherName} ${familyName}`;
  }
  next();
});