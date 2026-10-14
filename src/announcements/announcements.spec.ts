import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Announcement, AnnouncementSchema } from './schemas/announcement.schema';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementEditorGuard } from './announcement-editor.guard';
import { CreateAnnouncementDto } from './dto/announcement.dto';
import { ANNOUNCEMENT_UPLOAD_DIR, announcementMulterConfig } from './config/multer.config';
import {
  audienceOf,
  isSafeButtonLink,
  scheduleEdge,
  statusOf,
  youtubeIdOf,
} from './announcement.util';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { StudentClassResolverService } from '../enrollments/student-class-resolver.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-announcements${query}`,
);

describe('Announcement rules', () => {
  it('reads a bare date as the whole school day, the end inclusive', () => {
    expect(scheduleEdge('2026-10-18', 'start').toISOString()).toBe('2026-10-17T21:00:00.000Z');
    expect(scheduleEdge('2026-10-31', 'end').toISOString()).toBe('2026-10-31T20:59:59.999Z');
  });

  it('reads a time with no zone in Riyadh, and one with a zone as given', () => {
    expect(scheduleEdge('2026-10-18T08:30', 'start').toISOString()).toBe('2026-10-18T05:30:00.000Z');
    expect(scheduleEdge('2026-10-18T08:30:00Z', 'start').toISOString()).toBe('2026-10-18T08:30:00.000Z');
  });

  it('names the status, paused first', () => {
    const now = new Date('2026-10-14T06:00:00Z');
    const at = (iso: string) => new Date(iso);
    expect(statusOf({ isActive: true, startsAt: at('2026-10-01T00:00:00Z'), endsAt: null }, now)).toBe('live');
    expect(statusOf({ isActive: true, startsAt: at('2026-10-20T00:00:00Z'), endsAt: null }, now)).toBe('scheduled');
    expect(statusOf({ isActive: true, startsAt: at('2026-10-01T00:00:00Z'), endsAt: at('2026-10-10T00:00:00Z') }, now)).toBe('expired');
    expect(statusOf({ isActive: false, startsAt: at('2026-10-01T00:00:00Z'), endsAt: null }, now)).toBe('paused');
  });

  it.each([
    ['/student/library', true],
    ['https://school.example/register', true],
    ['http://school.example', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['//evil.example', false],
    ['/\\evil.example', false],
  ])('a button may point at %s: %s', (url, ok) => {
    expect(isSafeButtonLink(url)).toBe(ok);
  });

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/123456', null],
    ['https://youtube.com/watch?v=short', null],
  ])('finds the YouTube id in %s', (url, id) => {
    expect(youtubeIdOf(url)).toBe(id);
  });

  it('refuses a video body that names an upload — a video is only ever a link', async () => {
    // The same options main.ts gives the global pipe.
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const body = (video: any) => pipe.transform({ type: 'video', title: 'فيديو', video }, { type: 'body', metatype: CreateAnnouncementDto });
    await expect(body({ url: 'https://youtu.be/dQw4w9WgXcQ' })).resolves.toBeDefined();
    await expect(body({ source: 'upload', url: '/uploads/announcements/x.mp4' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gives every home-screen role an audience, and service staff none', () => {
    expect(['STUDENT', 'TEACHER', 'OWNER', 'SUPERVISOR', 'MANAGER', 'STAFF'].map(audienceOf)).toEqual([
      'STUDENT', 'TEACHER', 'ADMIN', 'ADMIN', 'ADMIN', null,
    ]);
  });
});

describe('AnnouncementEditorGuard', () => {
  const guard = new AnnouncementEditorGuard();
  const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
  const manager = (...perms: string[]) => ({ role: 'MANAGER', permissionsVersion: 2, permissions: perms });

  it('lets a file through for a slide being created or one being edited', async () => {
    await expect(guard.canActivate(ctx(manager('school.announcements.create')))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(manager('school.announcements.update')))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ role: 'OWNER', permissions: ['*'] }))).resolves.toBe(true);
  });

  it('refuses a manager who may only look', async () => {
    await expect(guard.canActivate(ctx(manager('school.announcements.read')))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * The carousel on the home screen: a school's slides, shown inside their dates
 * to the audience they are for, in the order the school put them.
 */
describe('AnnouncementsService', () => {
  let moduleRef: TestingModule;
  let service: AnnouncementsService;
  const models: Record<string, any> = {};

  const NOW = new Date('2026-10-14T09:00:00+03:00');
  const schoolId = new Types.ObjectId();
  const otherSchoolId = new Types.ObjectId();
  const OWNER = { userId: String(new Types.ObjectId()), schoolId: String(schoolId), role: 'OWNER', name: 'المالكة' };
  const OTHER_OWNER = { ...OWNER, schoolId: String(otherSchoolId) };
  const STUDENT = { userId: String(new Types.ObjectId()), schoolId: String(schoolId), role: 'STUDENT' };
  const TEACHER = { userId: String(new Types.ObjectId()), schoolId: String(schoolId), role: 'TEACHER' };

  const yearId = new Types.ObjectId();
  const lastYearClassId = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const ahmedId = new Types.ObjectId();
  const saraId = new Types.ObjectId();
  const foreignStudentId = new Types.ObjectId();

  const folder = join(ANNOUNCEMENT_UPLOAD_DIR, String(schoolId));
  const otherFolder = join(ANNOUNCEMENT_UPLOAD_DIR, String(otherSchoolId));
  /** A file as POST /announcements/uploads would have left it. */
  const uploaded = (ext: string, inFolder = folder, owner = schoolId) => {
    const name = `${randomUUID()}${ext}`;
    mkdirSync(inFolder, { recursive: true });
    writeFileSync(join(inFolder, name), 'x');
    return `/uploads/announcements/${owner}/${name}`;
  };
  const onDisk = (url: string) => existsSync(join('.', url));

  const as = <T>(school: Types.ObjectId, fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(school), isAdminContext: false }, fn);
  const create = (dto: any, user: any = OWNER) =>
    as(new Types.ObjectId(user.schoolId), () => service.create(user, { title: 'إعلان', ...dto }, NOW)).then((r) => r.data);
  const feed = (user: any) => as(new Types.ObjectId(user.schoolId), () => service.feed(user, NOW));
  const program = (extra: any = {}, user: any = OWNER) => create({ type: 'program', ...extra }, user);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Announcement.name, schema: AnnouncementSchema },
          { name: Student.name, schema: StudentSchema },
          { name: Class.name, schema: ClassSchema },
          { name: Enrollment.name, schema: EnrollmentSchema },
          { name: AcademicYear.name, schema: AcademicYearSchema },
        ]),
      ],
      providers: [AnnouncementsService, StudentClassResolverService],
    }).compile();
    service = moduleRef.get(AnnouncementsService);
    for (const name of [Announcement.name, Student.name, Class.name, Enrollment.name, AcademicYear.name]) {
      models[name] = moduleRef.get(getModelToken(name));
    }
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    rmSync(otherFolder, { recursive: true, force: true });
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(models)) await model.collection.deleteMany({});
    await models[AcademicYear.name].collection.insertOne({ _id: yearId, schoolId, name: '2026/2027', status: 'active' });
    await models[Class.name].collection.insertMany([
      { _id: classId, schoolId, name: '3/2', academicYearId: yearId },
      { _id: lastYearClassId, schoolId, name: '2/2', academicYearId: new Types.ObjectId() },
    ]);
    await models[Student.name].collection.insertMany([
      { _id: ahmedId, schoolId, firstName: 'أحمد', fatherName: 'محمد', familyName: 'العتيبي', email: 'ahmed@x.com', classId: lastYearClassId },
      { _id: saraId, schoolId, firstName: 'سارة', fatherName: 'خالد', familyName: 'القحطاني', email: 'sara@x.com' },
      { _id: foreignStudentId, schoolId: otherSchoolId, firstName: 'غريب', fatherName: 'غريب', familyName: 'غريب', email: 'other@x.com' },
    ]);
    // Promoted: last year's enrollment is still 'active', this year's wins.
    await models[Enrollment.name].collection.insertMany([
      { schoolId, studentId: ahmedId, classId: lastYearClassId, academicYearId: new Types.ObjectId(), status: 'active' },
      { schoolId, studentId: ahmedId, classId, academicYearId: yearId, status: 'active' },
    ]);
  });

  describe('honor roll', () => {
    it('names a picked student and the class they are in this year', async () => {
      const slide = await create({ type: 'honor_roll', students: [{ studentId: String(ahmedId), note: 'الأول على الصف' }] });
      expect(slide.students).toEqual([
        { studentId: String(ahmedId), name: 'أحمد محمد العتيبي', className: '3/2', note: 'الأول على الصف' },
      ]);
    });

    it('keeps what was typed over the record, and takes a name typed by hand', async () => {
      const slide = await create({
        type: 'honor_roll',
        students: [{ studentId: String(saraId), name: 'سارة خالد' }, { name: '  نورة  ', className: '1/1' }],
      });
      expect(slide.students).toEqual([
        { studentId: String(saraId), name: 'سارة خالد', className: null, note: null },
        { studentId: null, name: 'نورة', className: '1/1', note: null },
      ]);
    });

    it('needs a name, refuses the same student twice, and cannot reach another school', async () => {
      await expect(create({ type: 'honor_roll', students: [] })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ type: 'honor_roll', students: [{ note: 'بلا اسم' }] })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        create({ type: 'honor_roll', students: [{ studentId: String(saraId) }, { studentId: String(saraId) }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        create({ type: 'honor_roll', students: [{ studentId: String(foreignStudentId) }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('program and video', () => {
    it('refuses a title of nothing but spaces', async () => {
      await expect(program({ title: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a button that is not https or a page in the app', async () => {
      await expect(program({ cta: { label: 'اضغط', url: 'javascript:alert(1)' } })).rejects.toBeInstanceOf(BadRequestException);
      const slide = await program({ cta: { label: ' سجّل الآن ', url: '/student/library' } });
      expect(slide.cta).toEqual({ label: 'سجّل الآن', url: '/student/library' });
    });

    it('recognises a YouTube link and refuses a plain-http one', async () => {
      const slide = await create({ type: 'video', video: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
      expect(slide.video).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' });
      await expect(create({ type: 'video', video: { url: 'http://x.example/a.mp4' } })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(create({ type: 'video' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('takes any https host, and never a file on this server', async () => {
      const vimeo = await create({ type: 'video', video: { url: 'https://vimeo.com/123456' } });
      expect(vimeo.video).toEqual({ url: 'https://vimeo.com/123456', youtubeId: null });
      await expect(
        create({ type: 'video', video: { url: `/uploads/announcements/${schoolId}/${randomUUID()}.mp4` } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("drops the other types' fields, including when the type changes", async () => {
      const slide = await program({
        cta: { label: 'سجّل', url: '/x' },
        students: [{ name: 'ليس هنا' }],
        video: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      });
      expect(slide).toMatchObject({ students: [], video: null, cta: { label: 'سجّل', url: '/x' } });

      const update = (dto: any) => as(schoolId, () => service.update(OWNER, slide.id, dto, NOW)).then((r) => r.data);
      await expect(update({ type: 'video' })).rejects.toBeInstanceOf(BadRequestException);
      const video = await update({ type: 'video', video: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
      expect(video).toMatchObject({ type: 'video', cta: null, title: 'إعلان' });
    });
  });

  describe('uploaded images', () => {
    const filter = (originalname: string, mimetype: string) =>
      new Promise<{ error: any; accepted: boolean }>((resolve) =>
        announcementMulterConfig.fileFilter!({} as any, { originalname, mimetype } as any, (error: any, accepted?: boolean) =>
          resolve({ error, accepted: !!accepted }),
        ),
      );

    it('takes images up to 5 MB and points a video at YouTube instead', async () => {
      expect(await filter('banner.png', 'image/png')).toEqual({ error: null, accepted: true });
      const video = await filter('clip.mp4', 'video/mp4');
      expect(video.accepted).toBe(false);
      expect(video.error.message).toContain('يوتيوب');
      expect((await filter('x.svg', 'image/svg+xml')).accepted).toBe(false);
      expect((await filter('fake.png', 'video/mp4')).accepted).toBe(false);
      expect(announcementMulterConfig.limits!.fileSize).toBe(5 * 1024 * 1024);
    });

    it("takes only this school's own uploads, still on disk", async () => {
      const image = uploaded('.png');
      expect((await program({ imageUrl: image })).imageUrl).toBe(image);

      for (const imageUrl of [
        uploaded('.png', otherFolder, otherSchoolId),
        `/uploads/announcements/${schoolId}/${randomUUID()}.png`,
        uploaded('.mp4'),
        '/uploads/library/whatever.png',
        `/uploads/announcements/${schoolId}/../../library/x.png`,
        'https://cdn.example/banner.png',
      ]) {
        await expect(program({ imageUrl })).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('deletes a replaced image and the image of a deleted slide, but not one another slide still shows', async () => {
      const [first, second] = [uploaded('.jpg'), uploaded('.jpg')];
      const slide = await create({ type: 'video', imageUrl: first, video: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
      const twin = await program({ imageUrl: second });

      await as(schoolId, () => service.update(OWNER, slide.id, { imageUrl: second }, NOW));
      expect(onDisk(first)).toBe(false);

      await as(schoolId, () => service.remove(slide.id));
      expect(onDisk(second)).toBe(true); // still the twin's image

      await as(schoolId, () => service.remove(twin.id));
      expect(onDisk(second)).toBe(false);
    });

    it("returns the url under the school's own folder", () => {
      const result = service.acceptUpload(OWNER, { filename: 'abc.png', originalname: 'banner.png', size: 10 } as any);
      expect(result.data).toEqual({ url: `/uploads/announcements/${schoolId}/abc.png`, originalName: 'banner.png', size: 10 });
    });
  });

  describe('schedule and the feed', () => {
    it('shows a slide through the last day picked, and not before the first', async () => {
      const slide = await program({ startsAt: '2026-10-14', endsAt: '2026-10-14' });
      expect(slide.status).toBe('live');
      const at = (iso: string) => as(schoolId, () => service.feed(STUDENT, new Date(iso)));
      expect(await at('2026-10-13T20:59:59Z')).toEqual([]);
      expect((await at('2026-10-14T20:59:00Z')).map((a) => a.id)).toEqual([slide.id]); // 23:59 Riyadh
      expect(await at('2026-10-14T21:00:00Z')).toEqual([]);
    });

    it('refuses an end before the start, or one already past', async () => {
      await expect(program({ startsAt: '2026-10-20', endsAt: '2026-10-19' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(program({ endsAt: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an expired slide be edited without a new end', async () => {
      const slide = await as(schoolId, () =>
        service.create(OWNER, { type: 'program', title: 'قديم', endsAt: '2026-10-01' } as any, new Date('2026-09-01T00:00:00Z')),
      ).then((r) => r.data);
      const edited = await as(schoolId, () => service.update(OWNER, slide.id, { title: 'معدّل' }, NOW)).then((r) => r.data);
      expect(edited).toMatchObject({ title: 'معدّل', status: 'expired' });
    });

    it('shows only live slides, for the right audience, in order — and only to their school', async () => {
      const live = await program({ title: 'للجميع' });
      const studentsOnly = await program({ title: 'للطلاب', audiences: ['STUDENT'] });
      await program({ title: 'مجدول', startsAt: '2026-10-20' });
      const paused = await program({ title: 'موقوف' });
      await as(schoolId, () => service.setStatus(paused.id, false));
      await program({ title: 'مدرسة أخرى' }, OTHER_OWNER);

      expect((await feed(STUDENT)).map((a) => a.title)).toEqual(['للجميع', 'للطلاب']);
      expect((await feed(TEACHER)).map((a) => a.title)).toEqual(['للجميع']);
      expect(await feed({ ...STUDENT, role: 'STAFF' })).toEqual([]);

      const item = (await feed(STUDENT))[0];
      expect(Object.keys(item).sort()).toEqual(
        ['body', 'cta', 'durationSeconds', 'id', 'imageUrl', 'students', 'title', 'type', 'video'].sort(),
      );
      expect([live.order, studentsOnly.order]).toEqual([0, 1]);
    });

    it('lists by status for the admin screen', async () => {
      await program({ title: 'حي' });
      await program({ title: 'مجدول', startsAt: '2026-10-20' });
      const paused = await program({ title: 'موقوف' });
      await as(schoolId, () => service.setStatus(paused.id, false));

      const list = (status?: any) => as(schoolId, () => service.list({ status }, NOW));
      expect((await list()).map((a) => [a.title, a.status])).toEqual([
        ['حي', 'live'], ['مجدول', 'scheduled'], ['موقوف', 'paused'],
      ]);
      expect((await list('scheduled')).map((a) => a.title)).toEqual(['مجدول']);
      expect((await list('paused')).map((a) => a.title)).toEqual(['موقوف']);
    });
  });

  describe('order', () => {
    it('puts the listed slides first and keeps the rest after them', async () => {
      const [a, b, c, d] = await Promise.all(['أ', 'ب', 'ج', 'د'].map((title, order) => program({ title, order })));
      const result = await as(schoolId, () => service.reorder(OWNER, [c.id, a.id]));
      expect(result.data.map((s: any) => [s.title, s.order])).toEqual([['ج', 0], ['أ', 1], ['ب', 2], ['د', 3]]);
      expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
    });

    it("cannot reach another school's slide", async () => {
      const mine = await program();
      const theirs = await program({}, OTHER_OWNER);
      await expect(as(schoolId, () => service.reorder(OWNER, [theirs.id, mine.id]))).rejects.toBeInstanceOf(NotFoundException);
      await expect(as(schoolId, () => service.setStatus(theirs.id, false))).rejects.toBeInstanceOf(NotFoundException);
      await expect(as(schoolId, () => service.remove(theirs.id))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
