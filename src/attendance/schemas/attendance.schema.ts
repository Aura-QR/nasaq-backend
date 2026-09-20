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

  // ───────────────────────────────────────────────── the family's answer
  //
  // The absence notice asks the family why. Until these existed it asked for
  // something the system could not receive, so the answer arrived by phone if
  // it arrived at all, and the record kept saying only "absent".

  /** The family's account of the absence. Written once. */
  @Prop({ type: String, default: null })
  excuse: string | null;

  @Prop({ type: Date, default: null })
  excuseAt: Date | null;

  /** A medical note or similar, served from /uploads. */
  @Prop({ type: String, default: null })
  excuseAttachment: string | null;

  /**
   * Where the excuse stands with the school.
   *
   * null means none was sent. 'pending' is an excuse nobody has looked at yet
   * — the state the manager's list exists to empty.
   */
  @Prop({ type: String, enum: ['pending', 'accepted', 'rejected'], default: null })
  excuseStatus: 'pending' | 'accepted' | 'rejected' | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  excuseReviewedBy: mongoose.Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  excuseReviewedByName: string;

  @Prop({ type: Date, default: null })
  excuseReviewedAt: Date | null;

  /** Why the school accepted or refused it — the family is told this. */
  @Prop({ type: String, default: '' })
  excuseReviewNote: string;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
AttendanceSchema.plugin(tenantScopedPlugin);

AttendanceSchema.index({ schoolId: 1, date: 1 });
AttendanceSchema.index({ schoolId: 1, classId: 1, date: 1 });
AttendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 });

// The manager's queue: excuses waiting to be looked at, newest first.
AttendanceSchema.index({ schoolId: 1, excuseStatus: 1, excuseAt: -1 });


