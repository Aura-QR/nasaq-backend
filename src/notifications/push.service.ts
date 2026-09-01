import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
// firebase-admin v14 is fully modular; the old `admin.messaging()` namespace
// no longer exists on the root export.
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { DeviceToken, DevicePlatform } from './schemas/device-token.schema';

/** FCM rejects a data payload whose values are not all strings. */
const stringifyData = (data: Record<string, any>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
};

/**
 * A token FCM tells us is dead. Anything else — a network blip, a quota —
 * is transient and the row must survive it.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Delivers a notice to a device whose app is closed.
 *
 * This is a copy of a notification row, not a replacement for one. The row is
 * still the record; the push is only how someone finds out about it without
 * opening the app first. So a push failing is never allowed to fail the thing
 * it was announcing, and an unconfigured Firebase leaves the in-app bell
 * working exactly as before.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private app: App | null = null;

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly deviceTokenModel: Model<DeviceToken>,
  ) {}

  onModuleInit() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // Env vars cannot hold real newlines, so the key is stored with the \n
    // escaped and has to be put back before the SDK will parse it.
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.log(
        'Firebase is not configured — notifications stay in-app only.',
      );
      return;
    }

    try {
      this.app =
        getApps().find((a) => a.name === 'nasaq') ??
        initializeApp(
          { credential: cert({ projectId, clientEmail, privateKey }) },
          'nasaq',
        );
      this.logger.log(`Firebase ready for project ${projectId}.`);
    } catch (error: any) {
      // A malformed key must not stop the app booting.
      this.logger.error(`Firebase failed to initialise: ${error.message}`);
      this.app = null;
    }
  }

  get isConfigured(): boolean {
    return this.app !== null;
  }

  async registerToken(
    userId: string,
    token: string,
    platform: DevicePlatform = 'android',
  ) {
    // A device that is handed to another user must follow the new one, so the
    // token — not the pair — is the key.
    await this.deviceTokenModel
      .findOneAndUpdate(
        { token },
        {
          token,
          platform,
          userId: new mongoose.Types.ObjectId(String(userId)),
          lastSeenAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return { message: 'تم تسجيل الجهاز' };
  }

  /**
   * Scoped to the caller. Without the userId this would let anyone holding a
   * token string unregister somebody else's phone — the exemption that lets
   * this controller skip a role gate rests on every query being scoped to the
   * caller, and this is one of those queries.
   */
  async removeToken(userId: string, token: string) {
    await this.deviceTokenModel
      .deleteOne({ token, userId: new mongoose.Types.ObjectId(String(userId)) })
      .exec();
    return { message: 'تم إلغاء تسجيل الجهاز' };
  }

  /** Every device this user has logged in on. */
  async tokensFor(userId: any): Promise<string[]> {
    const rows = await this.deviceTokenModel
      .find({ userId: new mongoose.Types.ObjectId(String(userId)) })
      .select('token')
      .lean()
      .exec();

    return rows.map((row: any) => row.token);
  }

  /**
   * Never throws, and never rejects. Mirrors notify()'s contract: assigning
   * cover that then errored because a push could not be sent would leave the
   * class uncovered for the sake of a message.
   */
  async sendToUser(
    userId: any,
    payload: { title: string; body?: string; data?: Record<string, any> },
  ): Promise<void> {
    if (!this.app) return;

    try {
      const tokens = await this.tokensFor(userId);
      if (tokens.length === 0) return;

      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body ?? '' },
        data: stringifyData(payload.data ?? {}),
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      // FCM reports per-token, so a dead device does not hide a live one.
      const dead: string[] = [];
      response.responses.forEach((result, index) => {
        if (result.success) return;
        const code = (result.error as any)?.code;
        if (DEAD_TOKEN_CODES.has(code)) dead.push(tokens[index]);
        else this.logger.warn(`Push to a device failed: ${code}`);
      });

      if (dead.length > 0) {
        await this.deviceTokenModel.deleteMany({ token: { $in: dead } }).exec();
        this.logger.log(`Pruned ${dead.length} dead device token(s).`);
      }
    } catch (error: any) {
      this.logger.error(`Push to ${userId} failed: ${error.message}`);
    }
  }
}
