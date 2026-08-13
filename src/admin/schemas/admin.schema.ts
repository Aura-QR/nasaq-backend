import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Admin extends Document {
  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  email: string;

  // select: false — see the note on Teacher.password. Queries that need the hash
  // must ask for it explicitly with .select('+password')
  @Prop({ required: true, select: false })
  password: string;

  @Prop({ default: 'OWNER', enum: ['OWNER', 'MANAGER', 'SUPERVISOR'] })
  role: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ select: false })
  otp?: string;

  @Prop({ select: false })
  otpExpiry?: Date;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
AdminSchema.plugin(tenantScopedPlugin);

// Compound unique indexes scoped by schoolId
AdminSchema.index({ schoolId: 1, username: 1 }, { unique: true });
AdminSchema.index({ schoolId: 1, email: 1 }, { unique: true });
