import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const OUTBOUND_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

/**
 * One WhatsApp message we owe somebody, and what happened to it.
 *
 * This is an outbox, not a log. The row is written inside the same call that
 * creates the account, and the HTTP request to n8n happens after — so a
 * webhook that is down, slow, or misconfigured cannot fail an enrolment, and
 * cannot lose the message either. The cron picks up whatever is still pending.
 *
 * Deliberately NOT tenant-scoped. `tenantScopedPlugin` injects the school from
 * the request context, and the retry job runs on a timer with no request at
 * all — under that plugin every query would be scoped to `schoolId: null` and
 * the job would silently find nothing, which is exactly how the Friday
 * preparation cron destroyed a term's lecture references. `schoolId` is stored
 * and filtered explicitly instead.
 */
@Schema({ timestamps: true })
export class OutboundMessage extends Document {
  @Prop({ type: Types.ObjectId, ref: 'School', required: true, index: true })
  schoolId: Types.ObjectId;

  @Prop({ required: true, default: 'credentials.issued' })
  event: string;

  @Prop({ required: true, enum: ['STUDENT', 'TEACHER'], index: true })
  recipientRole: string;

  @Prop({ type: Types.ObjectId, required: false, default: null, index: true })
  recipientId: Types.ObjectId | null;

  @Prop({ default: '' })
  recipientName: string;

  /** E.164 digits, no `+`. Empty only on a row we skipped for lacking one. */
  @Prop({ default: '' })
  phone: string;

  /** Exactly what the school had typed, kept so a bad number can be corrected. */
  @Prop({ default: '' })
  rawPhone: string;

  @Prop({ default: '' })
  loginEmail: string;

  @Prop({ required: true, enum: ['created', 'password_reset', 'test'] })
  reason: string;

  /**
   * The plaintext password, held only until the message is delivered.
   *
   * `select: false` keeps it out of every read that does not ask for it, and
   * `clearSecret` removes it the moment the row reaches a terminal state — so
   * a password lives in this collection for seconds on the happy path, and
   * until the retries are exhausted on the unhappy one. Never return it from
   * an endpoint.
   */
  @Prop({ select: false, default: null })
  secret: string | null;

  @Prop({ required: true, enum: OUTBOUND_STATUSES, default: 'pending', index: true })
  status: OutboundStatus;

  @Prop({ default: 0 })
  attempts: number;

  /** When the cron may try again. null once the row is terminal. */
  @Prop({ type: Date, default: () => new Date(), index: true })
  nextAttemptAt: Date | null;

  @Prop({ type: Date, default: null })
  deliveredAt: Date | null;

  @Prop({ type: String, default: null })
  lastError: string | null;
}

export const OutboundMessageSchema = SchemaFactory.createForClass(OutboundMessage);

// The cron's only query: pending rows that are due, oldest first.
OutboundMessageSchema.index({ status: 1, nextAttemptAt: 1 });

// A delivery record is useful for a few weeks and a liability forever. Mongo
// drops the row — and with it any secret a dead delivery still holds.
OutboundMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);
