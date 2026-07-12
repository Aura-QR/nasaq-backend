import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';


@Schema({ timestamps: true })
export class Project extends Document {

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'GradesCriteria',
    index: true
  })
  gradesCriteriaId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  grade: number;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    required: true,
    index: true
  })
  classIds: mongoose.Types.ObjectId[];

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true
  })
  subjectId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  academicYear: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teacher',
    index: true
  })
  createdBy: mongoose.Types.ObjectId;

  @Prop({
    type: [
      {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        path: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],
    _id: false,
    default: [],
  })
  files: {
    filename: string;
    originalName: string;
    path: string;
    size: number;
  }[];
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

