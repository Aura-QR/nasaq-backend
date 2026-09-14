import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';
import { EntityPermission } from '../default-permissions';

/**
 * A school's named permission set for its assistants — «المالية»,
 * «وكيل شؤون الطلاب» — assigned per account.
 *
 * The role stays MANAGER. A title only replaces which permissions a manager's
 * token carries; login, routing and every @Roles check are unchanged. An
 * assistant with no title keeps the school's MANAGER row.
 */
@Schema({ collection: 'jobTitles', timestamps: true })
export class JobTitle extends Document {
  @Prop({ required: true, trim: true, maxlength: 60 })
  name: string;

  /** Which starter template it was created from, if any. Informational only. */
  @Prop({ type: String, default: null })
  templateKey: string | null;

  @Prop({ type: Object, required: true, default: {} })
  permissions: Record<string, EntityPermission>;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  updatedBy: Types.ObjectId | null;

  schoolId?: Types.ObjectId;
}

export const JobTitleSchema = SchemaFactory.createForClass(JobTitle);
JobTitleSchema.plugin(tenantScopedPlugin);
JobTitleSchema.index({ schoolId: 1, name: 1 }, { unique: true });
