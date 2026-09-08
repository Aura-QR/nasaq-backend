import mongoose, { Model, Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { CredentialsDeliveryService } from './credentials-delivery.service';
import {
  OutboundMessage,
  OutboundMessageSchema,
} from './schemas/outbound-message.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
const WEBHOOK = 'https://n8n.example.test/webhook/nasaq-credentials';

describe('CredentialsDeliveryService', () => {
  let outboundModel: Model<OutboundMessage>;
  let schoolModel: Model<School>;
  let service: CredentialsDeliveryService;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;
  const schoolId = new Types.ObjectId();

  const ok = () =>
    ({ ok: true, status: 200, text: async () => '' }) as any;
  const httpError = (status: number, body = 'boom') =>
    ({ ok: false, status, text: async () => body }) as any;

  const validInput = (overrides: Partial<any> = {}) => ({
    schoolId,
    recipientRole: 'STUDENT' as const,
    recipientId: new Types.ObjectId(),
    recipientName: 'أحمد علي أحمد',
    phone: '0501234567',
    loginEmail: 'au260001@student.auraschool.com',
    password: 'aB3dK9mZ',
    reason: 'created' as const,
    ...overrides,
  });

  /**
   * enqueue returns as soon as the row is written — the webhook call is
   * deliberately not awaited, so the caller's request does not hang on n8n.
   * Tests need the settled state, so they wait for it explicitly.
   */
  const enqueued = async (input: any) => {
    const row = await service.enqueue(input);
    await service.whenIdle();
    return row;
  };

  /** The row as it actually is in the database, password included. */
  const reload = (id: any) =>
    outboundModel.findById(id).select('+secret').lean().exec() as Promise<any>;

  beforeAll(async () => {
    await mongoose.connect(URI);
    outboundModel =
      (mongoose.models[OutboundMessage.name] as Model<OutboundMessage>) ||
      mongoose.model(OutboundMessage.name, OutboundMessageSchema);
    schoolModel =
      (mongoose.models[School.name] as Model<School>) ||
      mongoose.model(School.name, SchoolSchema);

    await schoolModel.create({
      _id: schoolId,
      name: 'مدارس مواهب المملكة الأهلية',
      slug: `wa-test-${Date.now()}`,
      email: 'owner@example.test',
      subscriptionStatus: 'active',
    });
  });

  afterAll(async () => {
    await outboundModel.deleteMany({ schoolId });
    await schoolModel.deleteOne({ _id: schoolId });
    await mongoose.disconnect();
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    await outboundModel.deleteMany({ schoolId });
    process.env.WHATSAPP_WEBHOOK_URL = WEBHOOK;
    process.env.WHATSAPP_WEBHOOK_SECRET = 'test-secret';
    process.env.WHATSAPP_DEFAULT_COUNTRY = '966';
    process.env.WHATSAPP_ENABLED = 'true';

    fetchMock = jest.fn().mockResolvedValue(ok());
    global.fetch = fetchMock as any;

    service = new CredentialsDeliveryService(outboundModel, schoolModel);
  });

  describe('the happy path', () => {
    it('posts the credentials and records the delivery', async () => {
      const row = await enqueued(validInput());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(WEBHOOK);
      expect(init.method).toBe('POST');

      const saved = await reload(row!._id);
      expect(saved.status).toBe('sent');
      expect(saved.attempts).toBe(1);
      expect(saved.deliveredAt).toBeInstanceOf(Date);
      expect(saved.nextAttemptAt).toBeNull();
    });

    it('sends a normalised phone, the login email and the school name', async () => {
      await enqueued(validInput());

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('credentials.issued');
      expect(body.reason).toBe('created');
      expect(body.school.name).toBe('مدارس مواهب المملكة الأهلية');
      expect(body.recipient.role).toBe('STUDENT');
      // 0501234567 as stored, +966 as dialled
      expect(body.recipient.phone).toBe('966501234567');
      expect(body.recipient.loginEmail).toBe('au260001@student.auraschool.com');
      expect(body.recipient.password).toBe('aB3dK9mZ');
    });

    it('signs the exact bytes it sends, so n8n can reject a forged post', async () => {
      await enqueued(validInput());

      const { headers, body } = fetchMock.mock.calls[0][1];
      expect(headers['X-Nasaq-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(service.verify(body, headers['X-Nasaq-Signature'])).toBe(true);
      // A single changed character must break it.
      expect(service.verify(body + ' ', headers['X-Nasaq-Signature'])).toBe(false);
    });

    it('carries the row id as an idempotency key, so a retry is not a second message', async () => {
      const row = await enqueued(validInput());
      const { headers, body } = fetchMock.mock.calls[0][1];
      expect(headers['X-Nasaq-Event-Id']).toBe(String(row!._id));
      expect(JSON.parse(body).eventId).toBe(String(row!._id));
    });

    it('drops the password from the database once it has been delivered', async () => {
      const row = await enqueued(validInput());
      const saved = await reload(row!._id);
      expect(saved.secret).toBeNull();
    });
  });

  describe('when n8n is unhappy', () => {
    it('keeps the row pending and schedules a retry, holding the password', async () => {
      fetchMock.mockResolvedValue(httpError(502));

      const row = await enqueued(validInput());
      const saved = await reload(row!._id);

      expect(saved.status).toBe('pending');
      expect(saved.attempts).toBe(1);
      expect(saved.lastError).toContain('502');
      expect(saved.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      // Still needed — the message has not been sent yet.
      expect(saved.secret).toBe('aB3dK9mZ');
    });

    it('records a timeout instead of throwing it at the caller', async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      );

      const row = await enqueued(validInput());
      const saved = await reload(row!._id);

      expect(saved.status).toBe('pending');
      expect(saved.lastError).toContain('n8n');
    });

    it('gives up after six attempts and stops holding the password', async () => {
      fetchMock.mockResolvedValue(httpError(500));

      const row = await enqueued(validInput());

      // Attempt 1 happened on enqueue; drive the remaining five.
      for (let i = 0; i < 5; i++) {
        await outboundModel.updateOne(
          { _id: row!._id },
          { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
        );
        await service.flush();
      }

      const saved = await reload(row!._id);
      expect(saved.status).toBe('failed');
      expect(saved.attempts).toBe(6);
      expect(saved.nextAttemptAt).toBeNull();
      expect(saved.secret).toBeNull();
    });

    it('never throws out of enqueue — an enrolment must not fail over a message', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND n8n'));
      await expect(service.enqueue(validInput())).resolves.not.toThrow();
      await service.whenIdle();
    });
  });

  describe('what it refuses to send', () => {
    it('records a student with no phone as skipped, and posts nothing', async () => {
      const row = await enqueued(validInput({ phone: '' }));

      expect(fetchMock).not.toHaveBeenCalled();
      const saved = await reload(row!._id);
      expect(saved.status).toBe('skipped');
      expect(saved.lastError).toContain('رقم الجوال');
      expect(saved.secret).toBeNull();
    });

    it('records an unusable phone as skipped, keeping what was typed so it can be fixed', async () => {
      const row = await enqueued(validInput({ phone: '123' }));
      const saved = await reload(row!._id);
      expect(saved.status).toBe('skipped');
      expect(saved.rawPhone).toBe('123');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('records the event as skipped when no webhook is configured, rather than silently doing nothing', async () => {
      delete process.env.WHATSAPP_WEBHOOK_URL;
      service = new CredentialsDeliveryService(outboundModel, schoolModel);

      const row = await enqueued(validInput());
      const saved = await reload(row!._id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(saved.status).toBe('skipped');
      expect(saved.lastError).toContain('WHATSAPP_WEBHOOK_URL');
    });

    it('honours WHATSAPP_ENABLED=false', async () => {
      process.env.WHATSAPP_ENABLED = 'false';
      service = new CredentialsDeliveryService(outboundModel, schoolModel);

      const row = await enqueued(validInput());
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await reload(row!._id)).status).toBe('skipped');
    });
  });

  describe('the retry job', () => {
    it('picks up a row that is due and leaves one that is not', async () => {
      fetchMock.mockResolvedValueOnce(httpError(503));
      const due = await enqueued(validInput());

      const notYet = await outboundModel.create({
        schoolId,
        recipientRole: 'TEACHER',
        recipientId: new Types.ObjectId(),
        recipientName: 'سمر',
        phone: '966500000000',
        loginEmail: 't@example.test',
        reason: 'created',
        secret: 'zzz',
        status: 'pending',
        nextAttemptAt: new Date(Date.now() + 60 * 60_000),
      });

      await outboundModel.updateOne(
        { _id: due!._id },
        { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
      );

      fetchMock.mockResolvedValue(ok());
      await service.flush();

      expect((await reload(due!._id)).status).toBe('sent');
      expect((await reload(notYet._id)).status).toBe('pending');
    });

    it('does nothing when the webhook is not configured', async () => {
      delete process.env.WHATSAPP_WEBHOOK_URL;
      await outboundModel.create({
        schoolId,
        recipientRole: 'STUDENT',
        recipientId: new Types.ObjectId(),
        recipientName: 'x',
        phone: '966500000000',
        loginEmail: 'x@example.test',
        reason: 'created',
        secret: 'zzz',
        status: 'pending',
        nextAttemptAt: new Date(Date.now() - 1000),
      });

      await service.flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not send a message twice when a tick lands while the first request is still in the air', async () => {
      /*
       * The regression this exists for: the row stays `pending` for the whole
       * of an in-flight request, so a cron tick during it matched the same row
       * and the parent received two WhatsApp messages carrying the same
       * password. The lease taken in attempt() is what closes that window.
       */
      let release: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => (release = resolve));
      fetchMock.mockImplementation(async () => {
        await inFlight;
        return ok();
      });

      const pending = service.enqueue(validInput());
      // Let the dispatch reach fetch, then run the cron on top of it.
      await new Promise((r) => setImmediate(r));
      await service.flush();

      release();
      await pending;
      await service.whenIdle();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not touch a row that has already been sent', async () => {
      const row = await enqueued(validInput());
      fetchMock.mockClear();

      await outboundModel.updateOne(
        { _id: row!._id },
        { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
      );
      await service.flush();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('what the school can see', () => {
    it('lists deliveries without ever exposing a password', async () => {
      fetchMock.mockResolvedValue(httpError(500)); // keep the secret on the row
      await enqueued(validInput());

      const rows = await service.list(String(schoolId));
      expect(rows).toHaveLength(1);
      expect(rows[0].phone).toBe('+966501234567');
      expect(rows[0].status).toBe('pending');
      expect(JSON.stringify(rows[0])).not.toContain('aB3dK9mZ');
      expect(Object.keys(rows[0])).not.toContain('secret');
    });

    it('shows one school nothing of another school\'s', async () => {
      await enqueued(validInput());
      const rows = await service.list(String(new Types.ObjectId()));
      expect(rows).toHaveLength(0);
    });

    it('filters by status', async () => {
      await enqueued(validInput());
      await enqueued(validInput({ phone: '' }));

      expect(await service.list(String(schoolId), { status: 'sent' })).toHaveLength(1);
      expect(await service.list(String(schoolId), { status: 'skipped' })).toHaveLength(1);
    });

    it('re-queues a failed delivery that still has its password', async () => {
      fetchMock.mockResolvedValue(httpError(500));
      const row = await enqueued(validInput());

      fetchMock.mockResolvedValue(ok());
      const result = await service.retry(String(schoolId), String(row!._id));
      await service.whenIdle();

      expect(result.message).toContain('إعادة');
      expect((await reload(row!._id)).status).toBe('sent');
    });

    it('says plainly that a delivered message cannot be resent, instead of sending a blank password', async () => {
      const row = await enqueued(validInput()); // delivered, secret wiped
      await outboundModel.updateOne({ _id: row!._id }, { $set: { status: 'failed' } });

      await expect(
        service.retry(String(schoolId), String(row!._id)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('will not retry another school\'s delivery', async () => {
      const row = await enqueued(validInput());
      await expect(
        service.retry(String(new Types.ObjectId()), String(row!._id)),
      ).rejects.toThrow();
    });
  });

  describe('the connection test', () => {
    it('posts a test event that carries no password', async () => {
      const result = await service.sendTest(String(schoolId), '0501234567');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('credentials.test');
      expect(body.recipient.password).toBe('');
      expect(result.data.phone).toBe('+966501234567');
      expect(result.data.status).toBe('sent');
    });

    it('reports a bad number rather than pretending it sent', async () => {
      const result = await service.sendTest(String(schoolId), 'not a phone');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.data.status).toBe('skipped');
      expect(result.message).toBe('لم يتم الإرسال');
    });
  });
});
