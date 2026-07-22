import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PlatformAdmin extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ required: true, default: 'SUPER_ADMIN' })
  role: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const PlatformAdminSchema = SchemaFactory.createForClass(PlatformAdmin);
