import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

/**
 * The three kinds of slide the home-screen carousel shows. Each one is drawn
 * differently by the clients, so the type decides which fields mean anything:
 *
 * - honor_roll — الطلاب المتميزون: a title and a list of names
 * - program    — إعلان برنامج: text, an image and an optional button
 * - video      — فيديو توعوي: a link to the clip on YouTube or the like
 */
export const ANNOUNCEMENT_TYPES = ['honor_roll', 'program', 'video'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

/**
 * Who sees a slide. ADMIN is the school's own staff accounts (owner, supervisor,
 * manager); service staff sign in only to record attendance and get no feed.
 */
export const ANNOUNCEMENT_AUDIENCES = ['STUDENT', 'TEACHER', 'ADMIN'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/**
 * One name on an honor roll.
 *
 * Snapshotted when the slide is saved, the way a discount is snapshotted onto a
 * financial record: the roll says who was outstanding in the term it was
 * written, and promoting the student next year must not move them to a class
 * they were not in when they earned it. `studentId` is kept so a client can
 * link to the student; it is null for a name typed by hand.
 */
@Schema({ _id: false })
export class HonorRollEntry {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Student', default: null })
  studentId: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, default: null })
  className: string | null;

  /** The reason, e.g. «الأول على الصف» or «حافظ لجزء عمّ». */
  @Prop({ type: String, default: null })
  note: string | null;
}
const HonorRollEntrySchema = SchemaFactory.createForClass(HonorRollEntry);

/**
 * Always a link, never a file on this server: streaming a clip to every home
 * screen is YouTube's job, not ours (see the upload config).
 */
@Schema({ _id: false })
export class AnnouncementVideo {
  /** An https URL. */
  @Prop({ type: String, required: true })
  url: string;

  /** Recognised from a YouTube link, so mobile can use the native player. */
  @Prop({ type: String, default: null })
  youtubeId: string | null;
}
const AnnouncementVideoSchema = SchemaFactory.createForClass(AnnouncementVideo);

@Schema({ _id: false })
export class AnnouncementCta {
  @Prop({ type: String, required: true })
  label: string;

  /** An https URL, or a path inside the app such as `/student/library`. */
  @Prop({ type: String, required: true })
  url: string;
}
const AnnouncementCtaSchema = SchemaFactory.createForClass(AnnouncementCta);

@Schema({ collection: 'announcements', timestamps: true })
export class Announcement extends Document {
  @Prop({ type: String, enum: ANNOUNCEMENT_TYPES, required: true })
  type: AnnouncementType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, default: null })
  body: string | null;

  /** A program's picture, an honor roll's background, a video's poster. */
  @Prop({ type: String, default: null })
  imageUrl: string | null;

  @Prop({ type: [HonorRollEntrySchema], default: [] })
  students: HonorRollEntry[];

  @Prop({ type: AnnouncementVideoSchema, default: null })
  video: AnnouncementVideo | null;

  @Prop({ type: AnnouncementCtaSchema, default: null })
  cta: AnnouncementCta | null;

  @Prop({ type: [String], enum: ANNOUNCEMENT_AUDIENCES, default: () => [...ANNOUNCEMENT_AUDIENCES] })
  audiences: AnnouncementAudience[];

  /** The instant the slide starts showing. */
  @Prop({ type: Date, required: true })
  startsAt: Date;

  /** The last instant it shows (inclusive); null runs until it is switched off. */
  @Prop({ type: Date, default: null })
  endsAt: Date | null;

  /** The on/off switch. A paused slide keeps its dates and comes back as it was. */
  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  /** Position in the carousel, lowest first. */
  @Prop({ type: Number, default: 0 })
  order: number;

  /** How long the slide stays before the next; null leaves it to the client. */
  @Prop({ type: Number, default: null })
  durationSeconds: number | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  createdById: Types.ObjectId | null;

  /** Denormalised so the admin list is readable without populating. */
  @Prop({ type: String, default: '' })
  createdByName: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
AnnouncementSchema.plugin(tenantScopedPlugin);

// The feed's query: this school's switched-on slides whose window holds now.
AnnouncementSchema.index({ schoolId: 1, isActive: 1, startsAt: 1, endsAt: 1 });
AnnouncementSchema.index({ schoolId: 1, order: 1 });
