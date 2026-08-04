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
    ref: 'SubjectOffering',
    required: false,
    default: null,
    index: true,
  })
  subjectOfferingId?: mongoose.Types.ObjectId;
}

export const LibrarySchema = SchemaFactory.createForClass(Library);
LibrarySchema.plugin(tenantScopedPlugin);

LibrarySchema.index({ schoolId: 1, subjectOfferingId: 1 });
