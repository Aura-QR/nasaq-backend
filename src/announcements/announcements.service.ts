import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { extname, join } from 'path';
import {
  Announcement,
  AnnouncementCta,
  AnnouncementType,
  AnnouncementVideo,
  HonorRollEntry,
} from './schemas/announcement.schema';
import {
  AnnouncementCtaDto,
  AnnouncementVideoDto,
  CreateAnnouncementDto,
  HonorRollEntryDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';
import {
  ANNOUNCEMENT_IMAGE_TYPES,
  ANNOUNCEMENT_UPLOAD_PREFIX,
  schoolFolderOf,
} from './config/multer.config';
import {
  audienceOf,
  cleanText,
  isHttpsUrl,
  isSafeButtonLink,
  liveFilter,
  scheduleEdge,
  statusFilter,
  statusOf,
  studentFullName,
  youtubeIdOf,
} from './announcement.util';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { StudentClassResolverService } from '../enrollments/student-class-resolver.service';

const SORT = { order: 1, createdAt: -1 } as const;
const UPLOAD_NAME = /^[0-9a-f-]{36}\.[a-z0-9]+$/;

type Content = Pick<Announcement, 'body' | 'imageUrl' | 'students' | 'video' | 'cta'>;

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectModel(Announcement.name) private readonly announcementModel: Model<Announcement>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    private readonly classResolver: StudentClassResolverService,
  ) {}

  // ─── The home screen ────────────────────────────────────────────────────

  /** The slides showing now for the caller's audience, in carousel order. */
  async feed(user: any, now: Date = new Date()) {
    const audience = audienceOf(user?.role);
    if (!audience) return [];
    const rows = await this.announcementModel
      .find({ ...liveFilter(now), audiences: audience })
      .sort(SORT)
      .lean()
      .exec();
    return rows.map((a) => this.toFeedItem(a));
  }

  // ─── Management ─────────────────────────────────────────────────────────

  async list(query: ListAnnouncementsQueryDto = {}, now: Date = new Date()) {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.status) Object.assign(filter, statusFilter(query.status, now));
    const rows = await this.announcementModel.find(filter).sort(SORT).lean().exec();
    return rows.map((a) => this.toAdminView(a, now));
  }

  async findOne(id: string) {
    return this.toAdminView(await this.load(id), new Date());
  }

  async create(user: any, dto: CreateAnnouncementDto, now: Date = new Date()) {
    const content = await this.buildContent(user, dto.type, dto);
    const { startsAt, endsAt } = this.buildSchedule(dto, null, now);

    let order = dto.order;
    if (order === undefined) {
      const last = await this.announcementModel.findOne().sort({ order: -1 }).select('order').lean().exec();
      order = last ? (last as any).order + 1 : 0;
    }

    const created = await this.announcementModel.create({
      type: dto.type,
      title: requiredTitle(dto.title),
      ...content,
      audiences: dto.audiences ?? undefined,
      startsAt,
      endsAt,
      isActive: dto.isActive ?? true,
      order,
      durationSeconds: dto.durationSeconds ?? null,
      createdById: Types.ObjectId.isValid(String(user?.userId)) ? new Types.ObjectId(String(user.userId)) : null,
      createdByName: user?.name ?? '',
    });

    return { message: 'تم إنشاء الإعلان', data: this.toAdminView(created.toObject(), now) };
  }

  async update(user: any, id: string, dto: UpdateAnnouncementDto, now: Date = new Date()) {
    const current = await this.load(id);
    const type = dto.type ?? current.type;
    const content = await this.buildContent(user, type, dto, current);
    const { startsAt, endsAt } = this.buildSchedule(dto, current, now);

    const set: Record<string, unknown> = { type, ...content, startsAt, endsAt };
    if (dto.title !== undefined) set.title = requiredTitle(dto.title);
    if (dto.audiences !== undefined) set.audiences = dto.audiences;
    if (dto.isActive !== undefined) set.isActive = dto.isActive;
    if (dto.order !== undefined) set.order = dto.order;
    if (dto.durationSeconds !== undefined) set.durationSeconds = dto.durationSeconds;

    const updated = await this.announcementModel
      .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('الإعلان غير موجود');

    await this.removeUnusedFiles(filesOf(current).filter((f) => !filesOf(updated).includes(f)));
    return { message: 'تم تحديث الإعلان', data: this.toAdminView(updated, now) };
  }

  /** The on/off switch. Idempotent: it sets, it does not flip. */
  async setStatus(id: string, isActive: boolean) {
    const updated = await this.announcementModel
      .findByIdAndUpdate(this.objectId(id), { $set: { isActive } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('الإعلان غير موجود');
    return {
      message: isActive ? 'تم تشغيل الإعلان' : 'تم إيقاف الإعلان',
      data: this.toAdminView(updated, new Date()),
    };
  }

  /**
   * Put slides in the order given. Any not listed keep their relative order
   * after the listed ones, so a screen that drags only the live slides does
   * not have to send the expired ones too.
   */
  async reorder(user: any, ids: string[]) {
    const all = await this.announcementModel.find().sort(SORT).select('_id').lean().exec();
    const known = new Set(all.map((a) => String(a._id)));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) throw new NotFoundException('إعلان في الترتيب غير موجود في هذه المدرسة');

    const listed = new Set(ids);
    const sequence = [...ids, ...all.map((a) => String(a._id)).filter((id) => !listed.has(id))];

    // bulkWrite runs no query middleware, so the tenant plugin never sees it:
    // the school goes in each filter by hand. The ids were read through the
    // scoped find above, so this only restates what is already true.
    const schoolId = new Types.ObjectId(String(user.schoolId));
    await this.announcementModel.bulkWrite(
      sequence.map((id, order) => ({
        updateOne: { filter: { _id: new Types.ObjectId(id), schoolId }, update: { $set: { order } } },
      })),
    );

    return { message: 'تم حفظ ترتيب الإعلانات', data: await this.list() };
  }

  async remove(id: string) {
    const deleted = await this.announcementModel.findByIdAndDelete(this.objectId(id)).lean().exec();
    if (!deleted) throw new NotFoundException('الإعلان غير موجود');
    await this.removeUnusedFiles(filesOf(deleted));
    return { message: 'تم حذف الإعلان', data: { id: String(deleted._id) } };
  }

  /**
   * What POST /announcements/uploads returns: the url to put on a slide.
   * Type and size were already enforced by the upload config, before the file
   * reached the disk.
   */
  acceptUpload(user: any, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('لم يُرفق ملف');
    return {
      message: 'تم رفع الصورة',
      data: {
        url: `${schoolUploadPrefix(user)}${file.filename}`,
        originalName: file.originalname,
        size: file.size,
      },
    };
  }

  // ─── Building a slide ───────────────────────────────────────────────────

  /**
   * The fields the slide's type uses, checked; every other type's fields
   * cleared. A slide switched from program to video keeps no button, and an
   * edit screen that sends its whole form state never stores the leftovers of
   * a tab the admin did not pick.
   */
  private async buildContent(
    user: any,
    type: AnnouncementType,
    dto: UpdateAnnouncementDto,
    current?: Announcement,
  ): Promise<Content> {
    const kept = <T>(field: 'students' | 'video' | 'cta', empty: T): T =>
      current?.type === type ? ((current as any)[field] ?? empty) : empty;

    const body = dto.body !== undefined ? cleanText(dto.body) : current?.body ?? null;

    let imageUrl = current?.imageUrl ?? null;
    if (dto.imageUrl !== undefined && dto.imageUrl !== imageUrl) {
      imageUrl = dto.imageUrl ? this.ownImage(user, dto.imageUrl) : null;
    }

    const content: Content = { body, imageUrl, students: [], video: null, cta: null };

    if (type === 'honor_roll') {
      content.students = dto.students !== undefined ? await this.resolveRoll(dto.students) : kept('students', []);
      if (!content.students.length) {
        throw new BadRequestException('أضف اسم طالب واحد على الأقل إلى لوحة التميز');
      }
    } else if (type === 'program') {
      content.cta = dto.cta !== undefined ? this.buildCta(dto.cta) : kept<AnnouncementCta | null>('cta', null);
    } else {
      content.video = dto.video !== undefined ? this.buildVideo(dto.video) : kept<AnnouncementVideo | null>('video', null);
      if (!content.video) throw new BadRequestException('ضع رابط الفيديو (يوتيوب مثلًا)');
    }

    return content;
  }

  private buildSchedule(dto: UpdateAnnouncementDto, current: Announcement | null, now: Date) {
    const startsAt = dto.startsAt !== undefined ? scheduleEdge(dto.startsAt, 'start') : current?.startsAt ?? now;
    let endsAt = current?.endsAt ?? null;
    if (dto.endsAt !== undefined) {
      endsAt = dto.endsAt === null ? null : scheduleEdge(dto.endsAt, 'end');
      // Only a date being set now: an expired slide can still be edited
      // without first being given a new end.
      if (endsAt && endsAt < now) throw new BadRequestException('تاريخ النهاية قد مضى');
    }
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
    }
    return { startsAt, endsAt };
  }

  /**
   * The roll, snapshotted. A picked student brings their name and the class
   * they are in now; a typed name stands as typed.
   */
  private async resolveRoll(entries: HonorRollEntryDto[]): Promise<HonorRollEntry[]> {
    const ids = entries.map((e) => e.studentId).filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('تكرر الطالب نفسه في لوحة التميز');

    const students = ids.length
      ? await this.studentModel
          .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
          .select('firstName fatherName familyName name')
          .lean()
          .exec()
      : [];
    const byId = new Map(students.map((s: any) => [String(s._id), s]));
    if (byId.size !== ids.length) throw new NotFoundException('طالب في لوحة التميز غير موجود في هذه المدرسة');

    const classOf = new Map<string, string>();
    for (const id of ids) {
      const [classId] = await this.classResolver.resolveClassIds(id);
      if (classId) classOf.set(id, classId);
    }
    const classes = classOf.size
      ? await this.classModel
          .find({ _id: { $in: [...new Set(classOf.values())].map((id) => new Types.ObjectId(id)) } })
          .select('name')
          .lean()
          .exec()
      : [];
    const className = new Map(classes.map((c: any) => [String(c._id), c.name as string]));

    return entries.map((entry) => {
      const student = entry.studentId ? byId.get(entry.studentId) : null;
      const name = cleanText(entry.name) ?? (student ? cleanText(studentFullName(student)) : null);
      if (!name) throw new BadRequestException('اكتب اسم الطالب أو اختره من القائمة');
      return {
        studentId: student ? new Types.ObjectId(entry.studentId) : null,
        name,
        className:
          cleanText(entry.className) ?? (entry.studentId ? className.get(classOf.get(entry.studentId) ?? '') ?? null : null),
        note: cleanText(entry.note),
      };
    });
  }

  private buildVideo(dto: AnnouncementVideoDto | null): AnnouncementVideo | null {
    if (!dto) return null;
    const url = dto.url.trim();
    if (!isHttpsUrl(url)) throw new BadRequestException('رابط الفيديو يجب أن يبدأ بـ https://');
    return { url, youtubeId: youtubeIdOf(url) };
  }

  private buildCta(dto: AnnouncementCtaDto | null): AnnouncementCta | null {
    if (!dto) return null;
    const url = dto.url.trim();
    if (!isSafeButtonLink(url)) {
      throw new BadRequestException('رابط الزر يجب أن يبدأ بـ https:// أو بـ / لصفحة داخل المنصة');
    }
    return { label: dto.label.trim(), url };
  }

  /**
   * A url from POST /announcements/uploads: an image, from this school's own
   * folder, and still on disk. The folder check is what makes deleting a
   * slide's image safe: no other school's slide can point at it.
   */
  private ownImage(user: any, url: string): string {
    const prefix = schoolUploadPrefix(user);
    const name = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    if (!UPLOAD_NAME.test(name)) {
      throw new BadRequestException('الصورة يجب أن تُرفع أولًا عبر رفع صور الإعلانات');
    }
    if (!ANNOUNCEMENT_IMAGE_TYPES[extname(name)]) throw new BadRequestException('الملف المرفق ليس صورة');
    if (!existsSync(localPath(url))) throw new BadRequestException('الصورة غير موجودة، ارفعها مرة أخرى');
    return url;
  }

  /** Best effort: a file left behind is clutter, a slide that fails to save is a bug. */
  private async removeUnusedFiles(urls: string[]) {
    for (const url of urls) {
      const stillUsed = await this.announcementModel.countDocuments({ imageUrl: url }).exec();
      if (!stillUsed) await unlink(localPath(url)).catch(() => undefined);
    }
  }

  // ─── Shapes ─────────────────────────────────────────────────────────────

  private toFeedItem(a: any) {
    return {
      id: String(a._id),
      type: a.type,
      title: a.title,
      body: a.body ?? null,
      imageUrl: a.imageUrl ?? null,
      students: (a.students ?? []).map((s: any) => ({ name: s.name, className: s.className ?? null, note: s.note ?? null })),
      video: a.video ? { url: a.video.url, youtubeId: a.video.youtubeId ?? null } : null,
      cta: a.cta ? { label: a.cta.label, url: a.cta.url } : null,
      durationSeconds: a.durationSeconds ?? null,
    };
  }

  private toAdminView(a: any, now: Date) {
    return {
      ...this.toFeedItem(a),
      students: (a.students ?? []).map((s: any) => ({
        studentId: s.studentId ? String(s.studentId) : null,
        name: s.name,
        className: s.className ?? null,
        note: s.note ?? null,
      })),
      audiences: a.audiences ?? [],
      startsAt: a.startsAt,
      endsAt: a.endsAt ?? null,
      isActive: a.isActive,
      order: a.order,
      status: statusOf(a, now),
      createdBy: a.createdById ? { id: String(a.createdById), name: a.createdByName ?? '' } : null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  private async load(id: string): Promise<Announcement> {
    const found = await this.announcementModel.findById(this.objectId(id)).lean().exec();
    if (!found) throw new NotFoundException('الإعلان غير موجود');
    return found as unknown as Announcement;
  }

  private objectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('صيغة المعرف غير صحيحة');
    return new Types.ObjectId(id);
  }
}

/** @IsNotEmpty lets "   " through; a slide with a blank heading is still blank. */
function requiredTitle(title: string): string {
  const text = cleanText(title);
  if (!text) throw new BadRequestException('اكتب عنوان الإعلان');
  return text;
}

function schoolUploadPrefix(user: any): string {
  return `${ANNOUNCEMENT_UPLOAD_PREFIX}${schoolFolderOf(user)}/`;
}

/** `/uploads/announcements/<school>/<file>` → where multer wrote it. */
function localPath(url: string): string {
  return join('.', url);
}

/** The files on this server a slide holds — its image, if uploaded. */
function filesOf(a: { imageUrl?: string | null }): string[] {
  return a.imageUrl ? [a.imageUrl] : [];
}
