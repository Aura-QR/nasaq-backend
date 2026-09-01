import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * Where to reach one installed app.
 *
 * Deliberately NOT tenant-scoped, unlike Notification. A push is sent from
 * inside notify(), and notify() is called from places that may not carry a
 * tenant context — a cron, a script. A scoped model there would silently
 * query schoolId: null, find no tokens, and send nothing, with no error to
 * show for it. That failure has already cost this project twice.
 *
 * recipientId is globally unique on its own, so scoping buys nothing here.
 */
@Schema({ collection: 'device_tokens', timestamps: true })
export class DeviceToken extends Document {
  /**
   * No `ref`: like a notification's recipient, the owner may be a Teacher, a
   * Manager, a Student or the Owner, and those live in different collections.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  /** The FCM registration token. One row per installed app. */
  @Prop({ type: String, required: true, unique: true })
  token: string;

  @Prop({ type: String, enum: DEVICE_PLATFORMS, default: 'android' })
  platform: DevicePlatform;

  /**
   * Bumped on every re-registration. FCM tokens go stale silently, so a row
   * untouched for months is a good candidate for pruning.
   */
  @Prop({ type: Date, default: Date.now })
  lastSeenAt: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// "Which devices does this user have" — the only question ever asked of it.
DeviceTokenSchema.index({ userId: 1 });
