import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const NOTIFICATION_TYPES = [
  'leave_approved',
  'leave_rejected',
  'cover_assigned',
  'cover_removed',
  'duty_assigned',
  'duty_removed',
  // Lateness. Three types rather than one, because they are three different
  // things to do: the admin is being informed, the teacher is being asked for
  // something, and the answer is coming back.
  'teacher_late',
  'late_reason_required',
  'late_reason_submitted',
  'student_absent',
  // The family's side of an absence: the answer coming in, and the school's
  // verdict going back out. Separate types because they are read by different
  // people and mean different things to do.
  'absence_excuse_submitted',
  'absence_excuse_reviewed',
  // The school's ruling on a teacher's account of a lateness.
  'late_reason_reviewed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types a client should interrupt the user with rather than file away.
 *
 * A notice in a bell is read when somebody opens the bell. These two are
 * useless read late — a teacher asked at noon why they were late at seven has
 * forgotten, and a parent who learns on Thursday that their child missed
 * Sunday learns it too late to do anything.
 */
export const PROMPT_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'late_reason_required',
  'student_absent',
];

/**
 * Something a user needs to be told, held until they read it.
 *
 * There is no push infrastructure in the project — no Firebase, no device
 * tokens — so this is where the school's own notices live. It is also the
 * shape FCM would later deliver rather than replace: a push is a copy of a
 * row, not a different thing.
 *
 * Without it the whole cover feature has a hole in the middle. A manager
 * assigns a substitute at eight in the morning and the substitute, who has no
 * reason to open a screen they were not expecting, never finds out. The class
 * sits empty and the system looks useless.
 */
@Schema({ collection: 'notifications', timestamps: true })
export class Notification extends Document {
  /**
   * No `ref`: a recipient may be a Teacher, a Manager or the Owner, and those
   * live in different collections.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  recipientId: Types.ObjectId;

  @Prop({ type: String, enum: NOTIFICATION_TYPES, required: true, index: true })
  type: NotificationType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, default: '' })
  body: string;

  /**
   * Where tapping it should go, and what it is about. Kept loose on purpose:
   * a notice is a message, and pinning it to a rigid payload shape would mean
   * a migration every time a new kind is added.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  data: Record<string, any>;

  @Prop({ type: Boolean, default: false, index: true })
  read: boolean;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  schoolId?: Types.ObjectId;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.plugin(tenantScopedPlugin);

// The two questions asked: "what is unread for me" and "my recent notices".
NotificationSchema.index({ schoolId: 1, recipientId: 1, read: 1 });
NotificationSchema.index({ schoolId: 1, recipientId: 1, createdAt: -1 });
