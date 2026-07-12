import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ collection: 'projectSubmissions', timestamps: true })
export class ProjectSubmission extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Project',
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Student',
    index: true,
  })
  studentId: mongoose.Types.ObjectId;

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

  @Prop({ default: null })
  achievedGrade: number;

  @Prop({ default: null })
  maxGrade: number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null,
  })
  gradedBy: mongoose.Types.ObjectId;

  @Prop({ default: null })
  gradedAt: Date;
}

export const ProjectSubmissionSchema = SchemaFactory.createForClass(ProjectSubmission);

ProjectSubmissionSchema.index({ projectId: 1, studentId: 1 }, { unique: true });
