import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'attendance', timestamps: true })
export class Attendance extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Student',
    index: true
  })
  studentId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Class',
    index: true
  })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ index: true })
  name: string;

  // Who recorded this absence. Without it a disputed record has no author.
  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  recordedBy: mongoose.Types.ObjectId | null;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
AttendanceSchema.plugin(tenantScopedPlugin);

AttendanceSchema.index({ schoolId: 1, date: 1 });
AttendanceSchema.index({ schoolId: 1, classId: 1, date: 1 });
AttendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 });


