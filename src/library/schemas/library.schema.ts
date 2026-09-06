import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';
import { FILE_REF, FileRefDto } from '../../common/dto/file-ref.dto';

@Schema({ timestamps: true })
export class Library extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: function() { return !this.kind || this.kind === 'link'; }, default: null })
  link: string;

  @Prop({ type: String, enum: ['link', 'file'], default: 'link' })
  kind: string;

  @Prop({ type: FILE_REF, _id: false, default: null, required: function() { return this.kind === 'file'; } })
  file: FileRefDto;

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
