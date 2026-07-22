import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Library extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  link: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: false,
    default: null,
  })
  subjectId?: mongoose.Types.ObjectId;

  @Prop({ required: false })
  academicYear?: string;
}

export const LibrarySchema = SchemaFactory.createForClass(Library);
LibrarySchema.plugin(tenantScopedPlugin);

LibrarySchema.index({ schoolId: 1, subjectId: 1 });
