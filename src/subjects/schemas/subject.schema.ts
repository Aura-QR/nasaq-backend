import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

@Schema({ timestamps: true })
export class Subject extends Document {
  @Prop({ required: true })
  subjectName: string;

  @Prop({ required: false })
  subjectCode?: string;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    default: [],
  })
  classIds: mongoose.Types.ObjectId[]; // Many-to-many: subject can be in multiple classes

}

export const SubjectSchema = SchemaFactory.createForClass(Subject);