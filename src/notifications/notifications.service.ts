import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import {
  Notification,
  NotificationType,
} from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  /**
   * Writes a notice.
   *
   * Never throws: a notification failing must not roll back the thing it was
   * announcing. Assigning cover that then errors because a notice could not
   * be written would leave the class uncovered for the sake of a message.
   */
  async notify(input: {
    recipientId: any;
    type: NotificationType;
    title: string;
    body?: string;
    data?: Record<string, any>;
  }): Promise<void> {
    try {
      await new this.notificationModel({
        recipientId: new mongoose.Types.ObjectId(String(input.recipientId)),
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        data: input.data ?? {},
      }).save();
    } catch (error: any) {
      this.logger.error(
        `Failed to write a ${input.type} notification: ${error.message}`,
      );
    }
  }

  async list(
    userId: string,
    filters: { unreadOnly?: boolean; limit?: number } = {},
  ) {
    const query: any = { recipientId: new mongoose.Types.ObjectId(userId) };
    if (filters.unreadOnly) query.read = false;

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

    const [rows, unread] = await Promise.all([
      this.notificationModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel
        .countDocuments({
          recipientId: new mongoose.Types.ObjectId(userId),
          read: false,
        })
        .exec(),
    ]);

    return { unread, items: rows };
  }

  async unreadCount(userId: string) {
    const unread = await this.notificationModel
      .countDocuments({
        recipientId: new mongoose.Types.ObjectId(userId),
        read: false,
      })
      .exec();

    return { unread };
  }

  async markRead(id: string, userId: string) {
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: id, recipientId: new mongoose.Types.ObjectId(userId) },
        { read: true, readAt: new Date() },
        { new: true },
      )
      .exec();

    if (!updated) {
      // Scoped to the caller, so a wrong id and somebody else's id are the
      // same answer — there is nothing here for you.
      throw new NotFoundException('الإشعار غير موجود');
    }

    return { message: 'تم', data: updated };
  }

  async markAllRead(userId: string) {
    const result = await this.notificationModel
      .updateMany(
        { recipientId: new mongoose.Types.ObjectId(userId), read: false },
        { read: true, readAt: new Date() },
      )
      .exec();

    return { message: 'تم', updated: result.modifiedCount ?? 0 };
  }
}
