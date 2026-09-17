import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from '../platform/schools/schemas/school.schema';

/** What Evolution calls the states an instance can be in. */
export type WhatsappState = 'open' | 'connecting' | 'close' | 'missing';

export interface WhatsappStatus {
  /** The Evolution instance this school owns. Always its slug. */
  instance: string;
  state: WhatsappState;
  /** The connected WhatsApp number, once there is one. */
  number: string | null;
  /** A data: URL to render, present only while pairing. */
  qr: string | null;
  connected: boolean;
}

/**
 * One WhatsApp number per school, connected by the school itself.
 *
 * Every school's credentials went out through a single shared number, which
 * is three problems wearing one coat. WhatsApp bans a number that sends the
 * same text to hundreds of strangers, and that ban would have taken every
 * school down together, not one. A parent received their child's password
 * from a number that was not their school's, which reads as a scam. And one
 * Evolution instance is one queue, so two schools enrolling on the same
 * morning wait behind each other.
 *
 * The school scans a QR code from its own WhatsApp — the same gesture as
 * WhatsApp Web, which is the whole reason to start here rather than at Meta's
 * official API: no business verification, no message templates, no cost, and
 * nothing for the school to understand.
 *
 * The instance is named after the school's slug, which is what the n8n
 * workflow reads from the event to decide where to send. So a school that
 * connects here starts sending from its own number with no deploy.
 *
 * ## Configuration
 *
 *   EVOLUTION_API_URL   base URL of the Evolution server
 *   EVOLUTION_API_KEY   the global admin key
 *
 * The key is an admin credential for every instance on that server: it never
 * leaves this service, and no response here carries it.
 */
@Injectable()
export class WhatsappInstanceService {
  private readonly logger = new Logger(WhatsappInstanceService.name);
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
  ) {}

  private get baseUrl(): string {
    return (process.env.EVOLUTION_API_URL ?? '').trim().replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return (process.env.EVOLUTION_API_KEY ?? '').trim();
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * The instance name for a school.
   *
   * Evolution takes this from the URL path, so anything outside a safe
   * alphabet is a way to address another school's instance. A slug is already
   * lowercase and hyphenated; this refuses whatever is not, rather than
   * quietly mangling it into a name that might belong to somebody else.
   */
  private async instanceNameFor(schoolId: string): Promise<string> {
    const school = await this.schoolModel
      .findById(schoolId)
      .select('slug name')
      .lean()
      .exec();

    if (!school) throw new NotFoundException('المدرسة غير موجودة');

    const slug = String((school as any).slug ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/i.test(slug)) {
      throw new BadRequestException(
        'معرّف المدرسة (slug) غير صالح لربط واتساب. يُرجى مراجعة إعدادات المدرسة.',
      );
    }
    return slug.toLowerCase();
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data: any }> {
    if (!this.configured) {
      throw new BadRequestException(
        'خدمة واتساب غير مهيأة على الخادم. يُرجى مراجعة مسؤول النظام.',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(WhatsappInstanceService.TIMEOUT_MS),
      });
    } catch (error: any) {
      this.logger.error(`Evolution ${method} ${path} failed: ${error?.message}`);
      throw new BadGatewayException('تعذر الاتصال بخدمة واتساب. حاول مرة أخرى.');
    }

    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return { ok: response.ok, status: response.status, data };
  }

  /**
   * Where this school's connection stands.
   *
   * A school that has never connected has no instance at all, and Evolution
   * answers 404 for it. That is not an error to report — it is the ordinary
   * first state, and the screen shows it as "not connected".
   */
  async status(schoolId: string): Promise<WhatsappStatus> {
    const instance = await this.instanceNameFor(schoolId);
    const result = await this.call('GET', `/instance/connectionState/${instance}`);

    if (result.status === 404) {
      return { instance, state: 'missing', number: null, qr: null, connected: false };
    }
    if (!result.ok) {
      throw new BadGatewayException(this.messageOf(result, 'تعذر قراءة حالة اتصال واتساب.'));
    }

    const state = this.stateOf(result.data);
    return {
      instance,
      state,
      number: await this.numberOf(instance),
      qr: null,
      connected: state === 'open',
    };
  }

  /**
   * Start pairing, and hand back the QR code for the school to scan.
   *
   * Creating an instance that already exists is an error on Evolution, so an
   * existing one is reconnected instead — a school reconnecting after logging
   * out of WhatsApp on its phone is the ordinary case, not a new school.
   */
  async connect(schoolId: string): Promise<WhatsappStatus> {
    const instance = await this.instanceNameFor(schoolId);

    const existing = await this.call('GET', `/instance/connectionState/${instance}`);

    if (existing.status === 404) {
      const created = await this.call('POST', '/instance/create', {
        instanceName: instance,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      if (!created.ok) {
        throw new BadGatewayException(
          this.messageOf(created, 'تعذر إنشاء اتصال واتساب لهذه المدرسة.'),
        );
      }
      return {
        instance,
        state: 'connecting',
        number: null,
        qr: this.qrOf(created.data),
        connected: false,
      };
    }

    if (!existing.ok) {
      throw new BadGatewayException(this.messageOf(existing, 'تعذر قراءة حالة اتصال واتساب.'));
    }

    if (this.stateOf(existing.data) === 'open') {
      return {
        instance,
        state: 'open',
        number: await this.numberOf(instance),
        qr: null,
        connected: true,
      };
    }

    const reconnect = await this.call('GET', `/instance/connect/${instance}`);
    if (!reconnect.ok) {
      throw new BadGatewayException(
        this.messageOf(reconnect, 'تعذر بدء ربط واتساب. حاول مرة أخرى.'),
      );
    }

    return {
      instance,
      state: 'connecting',
      number: null,
      qr: this.qrOf(reconnect.data),
      connected: false,
    };
  }

  /**
   * Disconnect the number.
   *
   * Logout, not delete: the instance keeps its name and settings, so the same
   * school reconnecting scans a code rather than being created again. A school
   * changing its number does exactly this and then connects.
   */
  async disconnect(schoolId: string): Promise<WhatsappStatus> {
    const instance = await this.instanceNameFor(schoolId);
    const result = await this.call('DELETE', `/instance/logout/${instance}`);

    if (!result.ok && result.status !== 404) {
      throw new BadGatewayException(this.messageOf(result, 'تعذر فصل واتساب.'));
    }

    return { instance, state: 'close', number: null, qr: null, connected: false };
  }

  /** The connected number, when Evolution knows one. Never worth failing over. */
  private async numberOf(instance: string): Promise<string | null> {
    const result = await this.call(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
    );
    if (!result.ok) return null;

    const rows = Array.isArray(result.data) ? result.data : [result.data];
    for (const row of rows) {
      const raw =
        row?.ownerJid ??
        row?.owner ??
        row?.instance?.owner ??
        row?.number ??
        null;
      if (raw) return String(raw).split('@')[0] || null;
    }
    return null;
  }

  /** Evolution reports state in more than one shape depending on the call. */
  private stateOf(data: any): WhatsappState {
    const raw = String(
      data?.instance?.state ?? data?.state ?? data?.instance?.status ?? '',
    ).toLowerCase();
    if (raw === 'open') return 'open';
    if (raw === 'connecting') return 'connecting';
    if (raw === 'close' || raw === 'closed') return 'close';
    return 'missing';
  }

  /** The pairing code as something an <img> can render. */
  private qrOf(data: any): string | null {
    const raw =
      data?.qrcode?.base64 ??
      data?.base64 ??
      data?.qrcode?.code ??
      data?.code ??
      null;
    if (!raw) return null;
    const value = String(raw);
    return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  }

  private messageOf(result: { data: any }, fallback: string): string {
    const raw =
      result?.data?.response?.message ??
      result?.data?.message ??
      result?.data?.error ??
      null;
    if (!raw) return fallback;
    return Array.isArray(raw) ? raw.join(' — ') : String(raw);
  }
}
