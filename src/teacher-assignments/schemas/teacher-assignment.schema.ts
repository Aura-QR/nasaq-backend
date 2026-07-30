import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class TeacherAssignment extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'SubjectOffering', required: true, index: true })
  subjectOfferingId: mongoose.Types.ObjectId;
}

export const TeacherAssignmentSchema = SchemaFactory.createForClass(TeacherAssignment);
TeacherAssignmentSchema.plugin(tenantScopedPlugin);
TeacherAssignmentSchema.index(
  { schoolId: 1, teacherId: 1, subjectOfferingId: 1 },
  { unique: true },
);
