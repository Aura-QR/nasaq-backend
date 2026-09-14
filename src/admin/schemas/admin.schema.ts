import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
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

  /**
   * MANAGER only: the school job title whose permissions this account logs in
   * with. null — the school's MANAGER row, as before titles existed.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'JobTitle', default: null })
  jobTitleId: Types.ObjectId | null;

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
