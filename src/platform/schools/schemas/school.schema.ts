import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class SchoolSettings {
  @Prop({ default: '2026/2027' })
  academicYear: string;

  @Prop({ default: 'Asia/Riyadh' })
  timezone: string;

  @Prop({ default: 'ar' })
  language: string;
}

const SchoolSettingsSchema = SchemaFactory.createForClass(SchoolSettings);

@Schema({ timestamps: true })
export class School extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop()
  logo?: string;

  @Prop()
  phone?: string;

  @Prop({ required: true, trim: true })
  email: string;

  @Prop({ default: 'Saudi Arabia' })
  country: string;

  @Prop()
  city?: string;

  @Prop()
  address?: string;

  @Prop({ default: 'trial' })
  subscriptionPlan: string;

  @Prop({
    required: true,
    enum: ['trialing', 'active', 'past_due', 'suspended', 'cancelled'],
    default: 'trialing',
  })
  subscriptionStatus: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Admin' })
  ownerId?: Types.ObjectId;

  @Prop({ type: SchoolSettingsSchema, default: () => ({}) })
  settings: SchoolSettings;
}

export const SchoolSchema = SchemaFactory.createForClass(School);
// Ensure slug has index
SchoolSchema.index({ slug: 1 }, { unique: true });
