import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import { OutboundMessage, OutboundStatus } from './schemas/outbound-message.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { normalizePhone } from './utils/phone.util';

export interface CredentialsEnqueueInput {
  schoolId: string | Types.ObjectId | null | undefined;
  recipientRole: 'STUDENT' | 'TEACHER';
  recipientId: string | Types.ObjectId;
  recipientName: string;
  /** As stored on the student/teacher — unnormalised. */
  phone: string | null | undefined;
  /** The address the person actually types into the login box. */
  loginEmail: string;
  /** Plaintext. Not logged, not returned, wiped once delivered. */
  password: string;
  reason: 'created' | 'password_reset';
}

/**
 * Sends a new account's login details to the person's WhatsApp.
 *
 * ## Why this is a webhook and not a call to Evolution API
 *
 * The obvious build is: POST straight to Evolution from here. It is fewer
 * moving parts and it is the wrong shape.
 *
 * The message text is Arabic prose that the school will want to change — and
 * every change would be a backend deploy. Delivery also fails in ways only the
 * WhatsApp side understands (instance disconnected, number not on WhatsApp,
 * rate limit), and handling those here means reimplementing what n8n already
 * does. So this service emits a *fact* — these credentials were issued to this
 * person — and n8n owns the wording, the Evolution call and its retries.
 *
 * What stays here is what n8n cannot do: never lose the event. The row is
 * written first and the HTTP call happens after, so an n8n outage delays a
 * message instead of dropping it, and never fails the enrolment that caused it.
 *
 * ## Configuration
 *
 *   WHATSAPP_WEBHOOK_URL       n8n Webhook node, production URL
 *   WHATSAPP_WEBHOOK_SECRET    shared secret; we sign every body with it
 *   WHATSAPP_DEFAULT_COUNTRY   digits, no '+' (default 966)
 *   WHATSAPP_ENABLED           'false' turns dispatch off, queue still records
 *
 * With no URL configured nothing is sent and every event is recorded as
 * `skipped` with the reason — visible in the deliveries list, rather than a
 * feature that appears to work and does nothing.
 */
@Injectable()
export class CredentialsDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(CredentialsDeliveryService.name);

  /** Minutes to wait before attempt n+1. Six tries spans about 17 hours. */
  private static readonly BACKOFF_MINUTES = [1, 5, 15, 60, 240, 720];
  private static readonly MAX_ATTEMPTS = CredentialsDeliveryService.BACKOFF_MINUTES.length;
  private static readonly TIMEOUT_MS = 15_000;
  /**
   * How long a dispatch owns its row.
   *
   * Comfortably longer than TIMEOUT_MS, so the cron cannot pick up a row whose
   * request is still in the air. Without this the message went out twice: the
   * row stays `pending` for the whole of an in-flight request, the tick that
   * lands during it matches, and the parent gets two WhatsApp messages with
   * the same password. Short enough that a process killed mid-request has its
   * row back within the minute.
   */
  private static readonly LEASE_MS = 60_000;
  /** One cron tick must not stall on a long backlog. */
  private static readonly BATCH = 25;

  /**
   * Every dispatch started by enqueue, chained.
   *
   * enqueue deliberately does not wait for the webhook — a student create must
   * not hang for fifteen seconds on n8n — but something has to be able to. This
   * is what `whenIdle()` awaits, for shutdown and for tests.
   */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    @InjectModel(OutboundMessage.name)
    private readonly outboundModel: Model<OutboundMessage>,
    @InjectModel(School.name)
    private readonly schoolModel: Model<School>,
  ) {}

  private get webhookUrl(): string {
    return (process.env.WHATSAPP_WEBHOOK_URL ?? '').trim();
  }

  private get secret(): string {
    return (process.env.WHATSAPP_WEBHOOK_SECRET ?? '').trim();
  }

  private get defaultCountry(): string {
    return (process.env.WHATSAPP_DEFAULT_COUNTRY ?? '966').trim();
  }

  private get enabled(): boolean {
    return (process.env.WHATSAPP_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('WhatsApp credential delivery is off (WHATSAPP_ENABLED=false).');
      return;
    }
    if (!this.webhookUrl) {
      this.logger.warn(
        'WHATSAPP_WEBHOOK_URL is not set — credentials will be queued as skipped, not sent.',
      );
      return;
    }
    if (!this.secret) {
      this.logger.warn(
        'WHATSAPP_WEBHOOK_SECRET is not set — the webhook body will be unsigned. ' +
          'Anyone who learns the URL can post fake credentials into the school WhatsApp.',
      );
    }
    this.logger.log(`WhatsApp credential delivery enabled -> ${this.redactUrl(this.webhookUrl)}`);
  }

  // ---------------------------------------------------------------- queueing

  /**
   * Record the event and try to deliver it.
   *
   * Never throws. A student must still be created when WhatsApp is down.
   */
  async enqueue(input: CredentialsEnqueueInput): Promise<OutboundMessage | null> {
    try {
      if (!input.schoolId) {
        this.logger.warn(
          `No schoolId on a ${input.recipientRole} credentials event — not queued.`,
        );
        return null;
      }

      const phone = normalizePhone(input.phone, this.defaultCountry);

      const base = {
        schoolId: new Types.ObjectId(String(input.schoolId)),
        event: 'credentials.issued',
        recipientRole: input.recipientRole,
        recipientId: new Types.ObjectId(String(input.recipientId)),
        recipientName: input.recipientName ?? '',
        phone: phone ?? '',
        rawPhone: input.phone ?? '',
        loginEmail: input.loginEmail ?? '',
        reason: input.reason,
      };

      const blocked = this.blockedReason(phone);
      if (blocked) {
        return await this.outboundModel.create({
          ...base,
          secret: null,
          status: 'skipped',
          nextAttemptAt: null,
          lastError: blocked,
        });
      }

      const row = await this.outboundModel.create({
        ...base,
        secret: input.password,
        status: 'pending',
        nextAttemptAt: new Date(),
      });

      // Deliberately not awaited: the caller is inside a create/update request
      // and must not wait on a third-party webhook. Whatever this misses, the
      // cron picks up.
      this.dispatchInBackground(row._id);

      return row;
    } catch (error: any) {
      // An outbox that throws would roll back an enrolment over a WhatsApp
      // message. Log and carry on.
      this.logger.error(`Could not queue credentials message: ${error?.message ?? error}`);
      return null;
    }
  }

  /** Why this event cannot be sent, or null if it can. */
  private blockedReason(phone: string | null): string | null {
    if (!this.enabled) return 'إرسال واتساب معطّل (WHATSAPP_ENABLED=false)';
    if (!this.webhookUrl) return 'لم يتم ضبط رابط واتساب (WHATSAPP_WEBHOOK_URL)';
    if (!phone) return 'رقم الجوال غير صالح أو غير مسجّل';
    return null;
  }

  // ------------------------------------------------------------- dispatching

  /** Start a dispatch nobody waits on, but that `whenIdle()` can wait for. */
  private dispatchInBackground(id: any): void {
    this.inFlight = this.inFlight.then(() =>
      this.attempt(id).catch((error) =>
        this.logger.error(`Dispatch failed for ${id}: ${error?.message ?? error}`),
      ),
    );
  }

  /** Resolves once every background dispatch has settled. */
  async whenIdle(): Promise<void> {
    await this.inFlight;
  }

  private async attempt(id: any): Promise<void> {
    /*
     * Claim the row before sending it.
     *
     * Pushing nextAttemptAt a lease ahead, atomically and only while the row is
     * still pending, is what stops two senders from picking up the same
     * message — the enqueue path and a cron tick, or two app instances behind a
     * load balancer. `findOneAndUpdate` is a single document operation, so
     * exactly one caller gets the document back and the rest get null.
     *
     * The `nextAttemptAt` clause is the whole of it: matching on status alone
     * lets both claimers through, because the row is still pending until the
     * first one finishes.
     */
    const doc = await this.outboundModel
      .findOneAndUpdate(
        { _id: id, status: 'pending', nextAttemptAt: { $lte: new Date() } },
        { $set: { nextAttemptAt: new Date(Date.now() + CredentialsDeliveryService.LEASE_MS) } },
        { new: true },
      )
      .select('+secret')
      .exec();
    if (!doc) return;

    const school = await this.schoolModel
      .findById(doc.schoolId)
      .select('name slug')
      .lean()
      .exec();

    const body = JSON.stringify({
      event: doc.event,
      eventId: String(doc._id),
      occurredAt: new Date().toISOString(),
      attempt: doc.attempts + 1,
      reason: doc.reason,
      school: {
        id: String(doc.schoolId),
        name: school?.name ?? '',
        slug: school?.slug ?? '',
      },
      recipient: {
        role: doc.recipientRole,
        id: doc.recipientId ? String(doc.recipientId) : null,
        name: doc.recipientName,
        phone: doc.phone,
        loginEmail: doc.loginEmail,
        password: doc.secret ?? '',
      },
    });

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nasaq-Event': doc.event,
          'X-Nasaq-Event-Id': String(doc._id),
          ...(this.secret ? { 'X-Nasaq-Signature': this.sign(body) } : {}),
        },
        body,
        signal: AbortSignal.timeout(CredentialsDeliveryService.TIMEOUT_MS),
      });

      if (response.ok) {
        await this.outboundModel.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'sent' as OutboundStatus,
              deliveredAt: new Date(),
              attempts: doc.attempts + 1,
              nextAttemptAt: null,
              lastError: null,
              secret: null, // the password leaves this collection on success
            },
          },
        );
        return;
      }

      const text = (await response.text().catch(() => '')).slice(0, 300);
      await this.recordFailure(doc, `HTTP ${response.status} ${text}`.trim());
    } catch (error: any) {
      const message =
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `لم يستجب n8n خلال ${CredentialsDeliveryService.TIMEOUT_MS / 1000} ثانية`
          : (error?.message ?? String(error));
      await this.recordFailure(doc, message);
    }
  }

  private async recordFailure(doc: OutboundMessage, error: string): Promise<void> {
    const attempts = doc.attempts + 1;
    const exhausted = attempts >= CredentialsDeliveryService.MAX_ATTEMPTS;

    if (exhausted) {
      this.logger.error(
        `Giving up on WhatsApp delivery ${doc._id} after ${attempts} attempts: ${error}`,
      );
      await this.outboundModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'failed' as OutboundStatus,
            attempts,
            nextAttemptAt: null,
            lastError: error,
            secret: null, // do not keep a password for a message nobody will send
          },
        },
      );
      return;
    }

    const minutes =
      CredentialsDeliveryService.BACKOFF_MINUTES[attempts - 1] ??
      CredentialsDeliveryService.BACKOFF_MINUTES[
        CredentialsDeliveryService.BACKOFF_MINUTES.length - 1
      ];

    await this.outboundModel.updateOne(
      { _id: doc._id },
      {
        $set: {
          attempts,
          nextAttemptAt: new Date(Date.now() + minutes * 60_000),
          lastError: error,
        },
      },
    );
  }

  /**
   * Anything still pending and due.
   *
   * Runs every minute; the backoff, not the tick, decides when a row is tried
   * again. `skipTenantScope` is not needed — this model carries no tenant
   * plugin precisely so that a job with no request context can see every
   * school's queue.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'whatsapp-credentials-outbox' })
  async flush(): Promise<void> {
    if (!this.enabled || !this.webhookUrl) return;

    const due = await this.outboundModel
      .find({ status: 'pending', nextAttemptAt: { $lte: new Date() } })
      .sort({ nextAttemptAt: 1 })
      .limit(CredentialsDeliveryService.BATCH)
      .select('_id')
      .exec();

    if (!due.length) return;
    this.logger.log(`Retrying ${due.length} pending WhatsApp message(s).`);

    // Sequential on purpose: an Evolution instance behind n8n is a single
    // WhatsApp session, and firing twenty-five at once is how a number gets
    // rate-limited or banned.
    for (const doc of due) {
      await this.attempt(doc._id);
    }
  }

  // ------------------------------------------------------------------ admin

  /** Recent deliveries for one school. Never includes the password. */
  async list(
    schoolId: string,
    filters: { status?: OutboundStatus; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const query: any = { schoolId: new Types.ObjectId(schoolId) };
    if (filters.status) query.status = filters.status;

    const rows = await this.outboundModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return rows.map((row: any) => ({
      id: String(row._id),
      event: row.event,
      role: row.recipientRole,
      recipientId: row.recipientId ? String(row.recipientId) : null,
      name: row.recipientName,
      phone: row.phone ? `+${row.phone}` : null,
      rawPhone: row.rawPhone || null,
      loginEmail: row.loginEmail,
      reason: row.reason,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      deliveredAt: row.deliveredAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Put a failed or skipped row back in the queue.
   *
   * A row whose secret has already been wiped cannot be resent — the password
   * is gone by design. Say so plainly and point at the fix, which is to set the
   * password again from the person's profile.
   */
  async retry(schoolId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('معرّف غير صالح');
    }

    const doc = await this.outboundModel
      .findOne({ _id: new Types.ObjectId(id), schoolId: new Types.ObjectId(schoolId) })
      .select('+secret')
      .exec();

    if (!doc) throw new NotFoundException('لا توجد رسالة بهذا المعرّف');
    if (doc.status === 'sent') {
      return { message: 'الرسالة مُرسلة بالفعل', data: { id, status: doc.status } };
    }
    if (!doc.secret) {
      throw new BadRequestException(
        'لم تعد كلمة المرور محفوظة لهذه الرسالة. أعد تعيين كلمة المرور من ملف المستخدم ليُرسل بلاغ جديد.',
      );
    }
    if (!doc.phone) {
      throw new BadRequestException(
        'رقم الجوال المسجّل غير صالح. صحّح الرقم في ملف المستخدم ثم أعد تعيين كلمة المرور.',
      );
    }

    doc.status = 'pending';
    doc.attempts = 0;
    doc.nextAttemptAt = new Date();
    doc.lastError = null;
    await doc.save();

    this.dispatchInBackground(doc._id);

    return { message: 'تمت إعادة جدولة الإرسال', data: { id, status: 'pending' } };
  }

  /**
   * Post a harmless event to the webhook so the wiring can be proven end to
   * end before a real student depends on it. Carries no password.
   */
  async sendTest(schoolId: string, rawPhone: string) {
    const blocked = this.blockedReason(normalizePhone(rawPhone, this.defaultCountry));
    const phone = normalizePhone(rawPhone, this.defaultCountry);

    const row = await this.outboundModel.create({
      schoolId: new Types.ObjectId(schoolId),
      event: 'credentials.test',
      recipientRole: 'TEACHER',
      recipientId: null,
      recipientName: 'اختبار الاتصال',
      phone: phone ?? '',
      rawPhone,
      loginEmail: '',
      reason: 'test',
      secret: null,
      status: blocked ? 'skipped' : 'pending',
      nextAttemptAt: blocked ? null : new Date(),
      lastError: blocked,
    });

    if (!blocked) await this.attempt(row._id);

    const saved = await this.outboundModel.findById(row._id).lean().exec();
    return {
      message: blocked ? 'لم يتم الإرسال' : 'تم إرسال رسالة الاختبار',
      data: {
        id: String(row._id),
        phone: phone ? `+${phone}` : null,
        status: (saved as any)?.status,
        lastError: (saved as any)?.lastError ?? null,
      },
    };
  }

  // ----------------------------------------------------------------- signing

  /**
   * `sha256=<hex>` over the exact bytes we send.
   *
   * n8n must recompute this over the raw body, not over a re-serialised copy —
   * key order and whitespace change the digest.
   */
  sign(body: string): string {
    return 'sha256=' + createHmac('sha256', this.secret).update(body, 'utf8').digest('hex');
  }

  /** Constant-time compare, for anything of ours that ever verifies a signature. */
  verify(body: string, signature: string): boolean {
    if (!this.secret || !signature) return false;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname.replace(/[^/]+$/, '…')}`;
    } catch {
      return '(invalid URL)';
    }
  }
}
