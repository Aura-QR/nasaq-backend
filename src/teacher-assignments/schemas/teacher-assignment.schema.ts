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

  /**
   * Pins the assignment to one class instead of the whole grade.
   *
   * An offering is subject × grade × term, so an assignment normally means
   * "Fatima teaches maths to grade 4" — every section included. That breaks
   * down when a grade is split between two teachers, and nothing recorded who
   * takes which section.
   *
   * null keeps the old meaning: any class in the grade.
   */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: false,
    default: null,
    index: true,
  })
  classId: mongoose.Types.ObjectId | null;
}

export const TeacherAssignmentSchema = SchemaFactory.createForClass(TeacherAssignment);
TeacherAssignmentSchema.plugin(tenantScopedPlugin);
// classId is part of the key: without it, pinning one teacher to two sections
// of the same grade collides. Mongo treats a missing field and an explicit
// null as different index entries, so existing rows need the default written
// out — see src/scripts/backfill-assignment-class.ts.
TeacherAssignmentSchema.index(
  { schoolId: 1, teacherId: 1, subjectOfferingId: 1, classId: 1 },
  { unique: true },
);
