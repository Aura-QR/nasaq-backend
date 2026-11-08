import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { HomeworkSubmission, SubmissionStatus } from './schemas/homework-submission.schema';
import { Preparation } from './schemas/preparation.schema';
import { PreparationResource } from './schemas/preparation-resource.schema';
import { Student } from '../students/schemas/student.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Class } from '../classes/schemas/class.schema';
import { HomeworkService } from './homework.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dayKey } from './homework-due';
import { todayAtSchool } from '../common/utils/school-date.util';

/** What a student may hand in: photos of the notebook, or a PDF. */
export const SUBMISSION_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
export const SUBMISSION_MAX_FILES = 6;
export const SUBMISSION_MAX_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};
const STAFF = ['OWNER', 'MANAGER', 'SUPERVISOR'];
const VISIBLE_TO_STUDENTS = ['pending', 'approved'];
/** How far back the teacher's list reaches. */
const TEACHER_WINDOW_DAYS = 60;
const UPLOAD_ROOT = './uploads/homework';

const id = (v: any): string => String(v?._id ?? v ?? '');
const oid = (v: any) => new Types.ObjectId(id(v));

/** What the student and the teacher see of a submission. Paths on disk stay here. */
function view(s: any) {
  if (!s) return null;
  return {
    status: s.status as SubmissionStatus,
    note: s.note ?? '',
    feedback: s.feedback ?? '',
    late: !!s.late,
    submittedAt: s.submittedAt ?? null,
    reviewedAt: s.reviewedAt ?? null,
    files: (s.files ?? []).map((f: any) => ({ name: f.name, url: f.url, size: f.size, mimetype: f.mimetype })),
  };
}

@Injectable()
export class HomeworkSubmissionService {
  constructor(
    @InjectModel(HomeworkSubmission.name) private readonly submissions: Model<HomeworkSubmission>,
    @InjectModel(PreparationResource.name) private readonly resources: Model<PreparationResource>,
    @InjectModel(Preparation.name) private readonly preparations: Model<Preparation>,
    @InjectModel(Student.name) private readonly students: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(Lecture.name) private readonly lectures: Model<Lecture>,
    @InjectModel(Class.name) private readonly classes: Model<Class>,
    private readonly homework: HomeworkService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ───────────────────────────────────────────── shared

  private async homeworkWithPrep(resourceId: string) {
    if (!Types.ObjectId.isValid(resourceId)) throw new NotFoundException('الواجب غير موجود');
    const resource: any = await this.resources.findOne({ _id: resourceId, type: 'homework' }).lean();
    if (!resource) throw new NotFoundException('الواجب غير موجود');
    const prep: any = await this.preparations.findById(resource.preparationId).lean();
    if (!prep) throw new NotFoundException('الواجب غير موجود');
    return { resource, prep };
  }

  /**
   * The class a preparation is for. Older preparations never stored
   * `classId`; their period (the live lecture, or the snapshot kept on the
   * preparation) still says which class it was.
   */
  private async classOf(prep: any): Promise<string> {
    if (prep.classId) return id(prep.classId);
    if (prep.lecture?.classId) return id(prep.lecture.classId);
    const lectureId = id(prep.lecture);
    if (!Types.ObjectId.isValid(lectureId)) return '';
    const lecture: any = await this.lectures.findById(lectureId).select('classId').lean();
    return lecture?.classId ? id(lecture.classId) : '';
  }

  /** The student's classes: active enrolments and `student.classId`, as the lesson page reads them. */
  private async classIdsOf(studentId: string): Promise<string[]> {
    const [rows, student] = await Promise.all([
      this.enrollments.find({ studentId, status: 'active' }).select('classId').lean(),
      this.students.findById(studentId).select('classId').lean(),
    ]);
    const ids = (rows as any[]).map((r) => id(r.classId));
    if ((student as any)?.classId) ids.push(id((student as any).classId));
    return [...new Set(ids.filter(Boolean))];
  }

  /** The teacher who wrote the lesson, the teacher of its period, or the administration. */
  private async assertCanReview(user: any, prep: any) {
    if (STAFF.includes(user?.role)) return;
    if (user?.role !== 'TEACHER') throw new ForbiddenException();
    if (id(prep.submittedBy) === id(user.userId)) return;
    const lectureId = id(prep.lecture);
    if (Types.ObjectId.isValid(lectureId)) {
      const lecture: any = await this.lectures.findById(lectureId).select('teacherId').lean();
      if (lecture && id(lecture.teacherId) === id(user.userId)) return;
    }
    if (prep.lecture?.teacherId && id(prep.lecture.teacherId) === id(user.userId)) return;
    throw new ForbiddenException('هذا الواجب ليس من دروسك');
  }

  private removeFiles(files: any[] = []) {
    for (const f of files) {
      try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* already gone */ }
    }
  }

  private async dueKeyOf(resource: any, prep: any): Promise<string | null> {
    return dayKey(resource.dueAt ?? (await this.homework.dueDateFor(prep)));
  }

  /** Active students of a class, by either source of where a student sits. */
  private async studentsOfClass(classId: string) {
    const enrolled = await this.enrollments.distinct('studentId', { classId: oid(classId), status: 'active' });
    return this.students
      .find({ isActive: true, $or: [{ classId: oid(classId) }, { _id: { $in: enrolled } }] })
      .select('name')
      .sort({ name: 1 })
      .lean();
  }

  // ───────────────────────────────────────────── the student

  async submit(user: any, resourceId: string, files: Express.Multer.File[] = [], note = '') {
    if (user?.role !== 'STUDENT') throw new ForbiddenException();
    const { resource, prep } = await this.homeworkWithPrep(resourceId);
    const classIds = await this.classIdsOf(user.userId);
    const classId = await this.classOf(prep);
    if (!classId || !classIds.includes(classId) || !VISIBLE_TO_STUDENTS.includes(prep.reviewStatus)) {
      throw new ForbiddenException('هذا الواجب ليس لفصلك');
    }
    if (!files.length) throw new BadRequestException('أرفق صورة الواجب أو ملف PDF');
    if (files.length > SUBMISSION_MAX_FILES) throw new BadRequestException(`الحد الأقصى ${SUBMISSION_MAX_FILES} ملفات`);
    for (const f of files) {
      if (!SUBMISSION_MIME.test(f.mimetype)) throw new BadRequestException('يُقبل الصور وملفات PDF فقط');
      if (!f.buffer?.length) throw new BadRequestException('أحد الملفات فارغ');
    }

    const existing: any = await this.submissions.findOne({ resourceId: resource._id, studentId: oid(user.userId) });
    if (existing?.status === 'accepted') throw new BadRequestException('قُبل هذا الواجب، ولا يمكن تعديل التسليم');

    const folder = path.join(UPLOAD_ROOT, id(resource._id), id(user.userId));
    fs.mkdirSync(folder, { recursive: true });
    const saved = files.map((f) => {
      // A random name: files under /uploads are served to anyone holding the address.
      const filename = `${crypto.randomBytes(16).toString('hex')}.${EXT[f.mimetype] ?? 'bin'}`;
      const dest = path.join(folder, filename);
      fs.writeFileSync(dest, f.buffer);
      return {
        name: Buffer.from(f.originalname || filename, 'latin1').toString('utf8').slice(0, 120),
        url: `/uploads/homework/${id(resource._id)}/${id(user.userId)}/${filename}`,
        path: dest,
        size: f.size,
        mimetype: f.mimetype,
        hash: crypto.createHash('sha256').update(f.buffer).digest('hex'),
      };
    });

    const due = await this.dueKeyOf(resource, prep);
    const late = !!due && todayAtSchool() > due;
    const previous = existing?.files ?? [];
    const row = await this.submissions.findOneAndUpdate(
      { resourceId: resource._id, studentId: oid(user.userId) },
      {
        $set: {
          preparationId: prep._id,
          classId: oid(classId),
          files: saved,
          note: String(note ?? '').trim().slice(0, 500),
          status: 'submitted',
          submittedAt: new Date(),
          late,
          reviewedBy: null,
          reviewedAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    this.removeFiles(previous);
    return { message: existing ? 'تم تحديث تسليم الواجب' : 'تم تسليم الواجب', data: view(row) };
  }

  /** Take a submission back before the teacher has looked at it. */
  async withdraw(user: any, resourceId: string) {
    if (user?.role !== 'STUDENT') throw new ForbiddenException();
    if (!Types.ObjectId.isValid(resourceId)) throw new NotFoundException('الواجب غير موجود');
    const row: any = await this.submissions.findOne({ resourceId: oid(resourceId), studentId: oid(user.userId) });
    if (!row) throw new NotFoundException('لا يوجد تسليم لهذا الواجب');
    if (row.status !== 'submitted') throw new BadRequestException('راجع المعلم هذا التسليم، ولا يمكن سحبه');
    this.removeFiles(row.files);
    await row.deleteOne();
    return { message: 'تم سحب التسليم', data: null };
  }

  /** The student's own submissions, by homework id, for «واجباتي». */
  async mineFor(studentId: string, resourceIds: string[]) {
    const ids = resourceIds.filter((v) => Types.ObjectId.isValid(v)).map(oid);
    if (!ids.length) return new Map<string, any>();
    const rows: any[] = await this.submissions.find({ studentId: oid(studentId), resourceId: { $in: ids } }).lean();
    return new Map(rows.map((r) => [id(r.resourceId), view(r)]));
  }

  // ───────────────────────────────────────────── the teacher

  /** Homework this teacher set lately, with how much of each class has handed it in. */
  async teacherHomework(user: any) {
    if (user?.role !== 'TEACHER') throw new ForbiddenException();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - TEACHER_WINDOW_DAYS);
    const preps: any[] = await this.preparations
      .find({ submittedBy: { $in: [id(user.userId), oid(user.userId)] }, weekOf: { $gte: since } })
      .select('_id lessonTitle subject weekOf lecture classId')
      .lean();
    if (!preps.length) return { data: [] };
    const rows: any[] = await this.resources
      .find({ preparationId: { $in: preps.map((p) => p._id) }, type: 'homework' })
      .lean();
    if (!rows.length) return { data: [] };

    const prepById = new Map(preps.map((p) => [id(p), p]));
    const used = [...new Set(rows.map((r) => id(r.preparationId)))].map((k) => prepById.get(k)).filter(Boolean);
    const classOfPrep = new Map<string, string>();
    for (const p of used) classOfPrep.set(id(p), await this.classOf(p));
    const classIds = [...new Set([...classOfPrep.values()].filter((v) => Types.ObjectId.isValid(v)))];
    const [names, due, classes, counts, sizes] = await Promise.all([
      this.homework.subjectNames(used.map((p) => id(p.subject))),
      this.homework.dueDates(used.filter((p) => rows.some((r) => id(r.preparationId) === id(p) && !r.dueAt))),
      this.classes.find({ _id: { $in: classIds } }).select('name').lean(),
      this.submissions.aggregate([
        { $match: { resourceId: { $in: rows.map((r) => r._id) } } },
        { $group: { _id: { r: '$resourceId', s: '$status' }, n: { $sum: 1 } } },
      ]),
      Promise.all(classIds.map(async (c) => [c, (await this.studentsOfClass(c)).length] as const)),
    ]);
    const className = new Map((classes as any[]).map((c) => [id(c), c.name]));
    const classSize = new Map(sizes);
    const tally = new Map<string, Record<string, number>>();
    for (const c of counts as any[]) {
      const k = id(c._id.r);
      tally.set(k, { ...(tally.get(k) ?? {}), [c._id.s]: c.n });
    }

    const data = rows.map((r) => {
      const prep = prepById.get(id(r.preparationId));
      const t = tally.get(id(r)) ?? {};
      const submitted = (t.submitted ?? 0) + (t.accepted ?? 0) + (t.returned ?? 0);
      return {
        _id: id(r),
        title: r.title ?? '',
        lessonTitle: prep.lessonTitle ?? '',
        subjectName: names.get(id(prep.subject)) ?? '',
        classId: classOfPrep.get(id(prep)) ?? '',
        className: className.get(classOfPrep.get(id(prep)) ?? '') ?? '',
        dueAt: dayKey(r.dueAt ?? due.get(id(prep)) ?? null),
        students: classSize.get(classOfPrep.get(id(prep)) ?? '') ?? 0,
        submitted,
        toReview: t.submitted ?? 0,
        accepted: t.accepted ?? 0,
        returned: t.returned ?? 0,
      };
    });
    data.sort((a, b) => String(b.dueAt ?? '').localeCompare(String(a.dueAt ?? '')));
    return { data };
  }

  /**
   * Every student of the class against this homework, handed in or not.
   *
   * A photo whose bytes match one handed in elsewhere is flagged: by another
   * student (the same picture passed round), or by the same student for a
   * different homework (an old page handed in again). A copy redrawn by hand
   * cannot be detected; the teacher still reads the work.
   */
  async submissionsFor(user: any, resourceId: string) {
    const { resource, prep } = await this.homeworkWithPrep(resourceId);
    await this.assertCanReview(user, prep);

    const classId = await this.classOf(prep);
    const [students, rows, klass, names, due] = await Promise.all([
      classId ? this.studentsOfClass(classId) : Promise.resolve([]),
      this.submissions.find({ resourceId: resource._id }).lean(),
      classId ? this.classes.findById(classId).select('name').lean() : Promise.resolve(null),
      this.homework.subjectNames([id(prep.subject)]),
      this.dueKeyOf(resource, prep),
    ]);
    const byStudent = new Map((rows as any[]).map((r) => [id(r.studentId), r]));

    const hashes = [...new Set((rows as any[]).flatMap((r) => (r.files ?? []).map((f: any) => f.hash)).filter(Boolean))];
    const matches: any[] = hashes.length
      ? await this.submissions.find({ 'files.hash': { $in: hashes } }).select('studentId resourceId files.hash').lean()
      : [];
    const otherIds = [...new Set(matches.map((m) => id(m.studentId)))];
    const otherNames = new Map(
      ((await this.students.find({ _id: { $in: otherIds } }).select('name').lean()) as any[]).map((s) => [id(s), s.name]),
    );
    const duplicatesOf = (row: any) => {
      const mine = new Set((row.files ?? []).map((f: any) => f.hash));
      const out: string[] = [];
      for (const m of matches) {
        if (!(m.files ?? []).some((f: any) => mine.has(f.hash))) continue;
        const sameStudent = id(m.studentId) === id(row.studentId);
        const sameHomework = id(m.resourceId) === id(row.resourceId);
        if (sameStudent && sameHomework) continue;
        out.push(sameStudent ? 'صورة سبق أن سلّمتها الطالبة لواجب آخر' : `مطابقة لتسليم ${otherNames.get(id(m.studentId)) ?? 'طالب آخر'}`);
      }
      return [...new Set(out)];
    };

    const list = (students as any[]).map((s) => {
      const row = byStudent.get(id(s));
      return { studentId: id(s), name: s.name ?? '', submission: view(row), duplicates: row ? duplicatesOf(row) : [] };
    });
    // Students who handed in but have since left the class still show.
    for (const r of rows as any[]) {
      if (list.some((x) => x.studentId === id(r.studentId))) continue;
      const s: any = await this.students.findById(r.studentId).select('name').lean();
      list.push({ studentId: id(r.studentId), name: s?.name ?? '', submission: view(r), duplicates: duplicatesOf(r) });
    }

    return {
      data: {
        homework: {
          _id: id(resource),
          title: resource.title ?? '',
          description: resource.description ?? '',
          lessonTitle: prep.lessonTitle ?? '',
          subjectName: names.get(id(prep.subject)) ?? '',
          className: (klass as any)?.name ?? '',
          dueAt: due,
        },
        students: list,
      },
    };
  }

  async review(user: any, resourceId: string, studentId: string, status: 'accepted' | 'returned', feedback = '') {
    if (!['accepted', 'returned'].includes(status)) throw new BadRequestException('حالة غير صحيحة');
    const { resource, prep } = await this.homeworkWithPrep(resourceId);
    await this.assertCanReview(user, prep);
    if (!Types.ObjectId.isValid(studentId)) throw new NotFoundException('لا يوجد تسليم لهذا الطالب');
    const note = String(feedback ?? '').trim().slice(0, 500);
    if (status === 'returned' && !note) throw new BadRequestException('اكتب سبب الإعادة ليعرف الطالب ما المطلوب');

    const row: any = await this.submissions.findOneAndUpdate(
      { resourceId: resource._id, studentId: oid(studentId) },
      { $set: { status, feedback: note, reviewedBy: oid(user.userId), reviewedAt: new Date() } },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('لا يوجد تسليم لهذا الطالب');

    const title = resource.title || prep.lessonTitle || 'الواجب';
    await this.notifications?.notify({
      recipientId: studentId,
      type: 'homework_reviewed' as any,
      title: status === 'accepted' ? 'قُبل واجبك' : 'أُعيد إليك الواجب',
      body: status === 'accepted'
        ? `قبل المعلم تسليمك لـ«${title}»${note ? `: ${note}` : '.'}`
        : `أعاد المعلم «${title}»: ${note}. عدّل الحل وسلّمه مرة أخرى من «واجباتي».`,
      data: { resourceId: id(resource), status },
    });
    return { message: status === 'accepted' ? 'تم قبول الواجب' : 'تمت إعادة الواجب للطالب', data: view(row) };
  }
}
