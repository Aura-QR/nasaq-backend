import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Project extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'GradesCriteria',
    index: true,
  })
  gradesCriteriaId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  grade: number;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    required: true,
    index: true,
  })
  classIds: mongoose.Types.ObjectId[];

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true,
  })
  subjectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicYear',
    required: true,
    index: true,
  })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Term',
    required: false,
    default: null,
    index: true,
  })
  termId?: mongoose.Types.ObjectId;

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
    index: true,
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
ProjectSchema.plugin(tenantScopedPlugin);

ProjectSchema.index({ schoolId: 1, classIds: 1 });
ProjectSchema.index({ schoolId: 1, academicYearId: 1 });
ProjectSchema.index({ schoolId: 1, termId: 1 });
ProjectSchema.index({ schoolId: 1, createdAt: -1 });
