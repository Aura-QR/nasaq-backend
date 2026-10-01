import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * That a teacher has been asked about a given day's absence.
 *
 * Exists only so the end-of-day notice goes out once. The sweep runs every
 * fifteen minutes and a server can restart mid-run; the unique index is what
 * makes the second attempt a no-op instead of a second push to her phone.
 */
@Schema({ collection: 'teacherAbsenceNotices', timestamps: true })
export class TeacherAbsenceNotice extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Teacher', required: true })
  teacherId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date;
}

export const TeacherAbsenceNoticeSchema =
  SchemaFactory.createForClass(TeacherAbsenceNotice);
TeacherAbsenceNoticeSchema.plugin(tenantScopedPlugin);
TeacherAbsenceNoticeSchema.index(
  { schoolId: 1, teacherId: 1, date: 1 },
  { unique: true },
);
