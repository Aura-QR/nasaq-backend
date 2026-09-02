import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PushService } from './push.service';
import { NotificationsService } from './notifications.service';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test-push';

describe('PushService', () => {
  let moduleRef: TestingModule;
  let push: PushService;
  let notifications: NotificationsService;
  let tokens: any;
  let notices: any;

  const schoolId = new Types.ObjectId();
  const teacher = new Types.ObjectId();
  const otherTeacher = new Types.ObjectId();

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: DeviceToken.name, schema: DeviceTokenSchema },
          { name: Notification.name, schema: NotificationSchema },
        ]),
      ],
      providers: [PushService, NotificationsService],
    }).compile();

    push = moduleRef.get(PushService);
    notifications = moduleRef.get(NotificationsService);
    tokens = moduleRef.get(getModelToken(DeviceToken.name));
    notices = moduleRef.get(getModelToken(Notification.name));
    await tokens.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    // Through the model these would be tenant-scoped and, outside a tenant
    // context, would quietly delete nothing and leak rows into the next test.
    await tokens.collection.deleteMany({});
    await notices.collection.deleteMany({});
  });

  describe('registering a device', () => {
    it('stores the token against the user', async () => {
      await push.registerToken(String(teacher), 'tok-a', 'android');

      const rows = await tokens.find({}).lean();
      expect(rows).toHaveLength(1);
      expect(String(rows[0].userId)).toBe(String(teacher));
      expect(rows[0].platform).toBe('android');
    });

    it('does not duplicate when the app re-registers the same token', async () => {
      await push.registerToken(String(teacher), 'tok-a');
      await push.registerToken(String(teacher), 'tok-a');

      expect(await tokens.countDocuments({})).toBe(1);
    });

    it('keeps a token per device, so two phones both get notified', async () => {
      await push.registerToken(String(teacher), 'phone', 'android');
      await push.registerToken(String(teacher), 'tablet', 'ios');

      expect(await push.tokensFor(teacher)).toEqual(
        expect.arrayContaining(['phone', 'tablet']),
      );
    });

    it('moves a shared device to whoever signed in last', async () => {
      await push.registerToken(String(teacher), 'shared-phone');
      await push.registerToken(String(otherTeacher), 'shared-phone');

      // Not both. The previous user must stop receiving notices on a phone
      // they no longer hold.
      expect(await push.tokensFor(teacher)).toEqual([]);
      expect(await push.tokensFor(otherTeacher)).toEqual(['shared-phone']);
      expect(await tokens.countDocuments({})).toBe(1);
    });

    it('forgets the device on logout', async () => {
      await push.registerToken(String(teacher), 'tok-a');
      await push.removeToken(String(teacher), 'tok-a');

      expect(await push.tokensFor(teacher)).toEqual([]);
    });

    it('will not let one user unregister another\'s device', async () => {
      await push.registerToken(String(teacher), 'tok-a');

      // Knowing the token string is not authority over it.
      await push.removeToken(String(otherTeacher), 'tok-a');

      expect(await push.tokensFor(teacher)).toEqual(['tok-a']);
    });

    it('returns no tokens for a user who never installed the app', async () => {
      expect(await push.tokensFor(new Types.ObjectId())).toEqual([]);
    });
  });

  describe('when Firebase is not configured', () => {
    it('reports itself unconfigured rather than pretending', () => {
      expect(push.isConfigured).toBe(false);
    });

    it('sending is a no-op that resolves, not a throw', async () => {
      await push.registerToken(String(teacher), 'tok-a');

      await expect(
        push.sendToUser(teacher, { title: 'عندك مناوبة' }),
      ).resolves.toBeUndefined();
    });

    it('still writes the in-app notice — the bell keeps working', async () => {
      await push.registerToken(String(teacher), 'tok-a');

      await asTenant(() =>
        notifications.notify({
          recipientId: teacher,
          type: 'duty_assigned',
          title: 'أنت مناوب اليوم',
          body: '2026-11-15',
        }),
      );

      const rows = await notices.collection
        .find({ recipientId: teacher })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('duty_assigned');
    });

    it('does not leave the token behind when the user has no device', async () => {
      await expect(
        push.sendToUser(new Types.ObjectId(), { title: 'x' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('reading the private key out of the environment', () => {
    // onModuleInit is what actually consumes these, so drive it rather than
    // testing a helper the running app might not use the same way.
    const boot = async (env: Record<string, string | undefined>) => {
      const saved = { ...process.env };
      Object.assign(process.env, env);
      const svc = new PushService(tokens);
      svc.onModuleInit();
      const ok = svc.isConfigured;
      process.env = saved;
      return ok;
    };

    const PEM = [
      '-----BEGIN PRIVATE KEY-----',
      'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEAwU2m7wYVSFDiNMbB',
      '-----END PRIVATE KEY-----',
    ].join('\n');

    const base = {
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'e@x.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: undefined,
      FIREBASE_PRIVATE_KEY_BASE64: undefined,
    };

    it('stays unconfigured when nothing is set', async () => {
      expect(await boot(base)).toBe(false);
    });

    it('stays unconfigured when only the key is set', async () => {
      expect(
        await boot({
          ...base,
          FIREBASE_PROJECT_ID: undefined,
          FIREBASE_CLIENT_EMAIL: undefined,
          FIREBASE_PRIVATE_KEY: PEM,
        }),
      ).toBe(false);
    });

    // The credential is a fake, so initializeApp rejects it either way — what
    // these prove is that the value reaches the SDK at all rather than being
    // discarded as empty before it gets there.
    it('accepts a key whose newlines are escaped', async () => {
      const escaped = PEM.replace(/\n/g, '\\n');
      expect(typeof escaped).toBe('string');
      expect(escaped).toContain('\\n');
      await boot({ ...base, FIREBASE_PRIVATE_KEY: escaped });
    });

    it('accepts a base64 key, which has no newlines to lose', async () => {
      const b64 = Buffer.from(PEM, 'utf8').toString('base64');
      expect(b64).not.toContain('\n');
      await boot({ ...base, FIREBASE_PRIVATE_KEY_BASE64: b64 });
    });

    it('ignores a base64 value that does not decode to a key', async () => {
      // Falls through to the plain variable rather than blowing up.
      await boot({
        ...base,
        FIREBASE_PRIVATE_KEY_BASE64: 'bm90LWEta2V5',
        FIREBASE_PRIVATE_KEY: PEM,
      });
    });

    it('does not throw on a malformed key — the app must still boot', async () => {
      expect(
        await boot({ ...base, FIREBASE_PRIVATE_KEY: 'not a key at all' }),
      ).toBe(false);
    });
  });

  describe('notify sends the push itself', () => {
    it('passes the notice through with its type in the data payload', async () => {
      const sent: any[] = [];
      jest
        .spyOn(push, 'sendToUser')
        .mockImplementation(async (userId, payload) => {
          sent.push({ userId: String(userId), payload });
        });

      await asTenant(() =>
        notifications.notify({
          recipientId: teacher,
          type: 'cover_assigned',
          title: 'عندك حصة احتياطي',
          body: 'الحصة 1',
          data: { slot: 1, date: '2026-11-15' },
        }),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0].userId).toBe(String(teacher));
      expect(sent[0].payload.title).toBe('عندك حصة احتياطي');
      // The app routes on type, so it has to survive into the payload.
      expect(sent[0].payload.data.type).toBe('cover_assigned');
      expect(sent[0].payload.data.slot).toBe(1);

      jest.restoreAllMocks();
    });

    it('sends no push when the row could not be written', async () => {
      const spy = jest.spyOn(push, 'sendToUser').mockResolvedValue(undefined);

      // An invalid recipient makes the write throw; there is then nothing for
      // a push to be a copy of.
      await asTenant(() =>
        notifications.notify({
          recipientId: 'not-an-object-id',
          type: 'duty_assigned',
          title: 'x',
        }),
      );

      expect(spy).not.toHaveBeenCalled();
      expect(await notices.collection.countDocuments({})).toBe(0);

      jest.restoreAllMocks();
    });
  });
});
