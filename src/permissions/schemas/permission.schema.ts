import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Permission extends Document {
  @Prop({ required: true, enum: ['ADMIN', 'OWNER', 'MANAGER', 'TEACHER', 'STUDENT'] })
  role: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'School', default: null, index: true })
  schoolId: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', default: null, index: true })
  userId: MongooseSchema.Types.ObjectId | null;

  @Prop({
    type: Object,
    required: true,
    default: {},
  })
  permissions: Record<string, { read: boolean; add: boolean; edit: boolean; delete: boolean }>;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);

// Compound unique index to allow templates per role, per school, and overrides per user
PermissionSchema.index({ schoolId: 1, userId: 1, role: 1 }, { unique: true });
