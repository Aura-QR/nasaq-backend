import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePreparationDto } from './dto/create-preparation.dto';
import { UpdatePreparationDto } from './dto/update-preparation.dto';
import { BulkCreatePreparationDto } from './dto/bulk-create-preparation.dto';
import { Preparation } from './schemas/preparation.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import * as fs from 'fs';
import * as path from 'path';
import {
  currentWeekOf,
  lessonDateFor,
  startOfWeek,
  toDateOnlyString,
  WEEK_DAYS,
} from './utils/week.util';

/**
 * Query keys `GET /preparation` understands. Anything else is a client bug,
 * and used to be answered with an empty 200 — which reads as "no results"
 * when it actually means "I have no such field". The frontend grew a whole
 * fallback chain around that (`teacherId` → `lectureId` → `lecture`), so the
 * aliases below are kept working rather than rejected.
 */
const FILTER_ALIASES: Record<string, string> = {
  teacherId: 'submittedBy',
  lectureId: 'lecture',
};

const TEXT_FILTERS = ['name', 'lessonTitle'];
const EXACT_FILTERS = [
  'lecture',
  'subject',
  'submittedBy',
  'classId',
  'termId',
  'reviewStatus',
];
const WEEK_FILTERS = ['weekOf', 'weekFrom', 'weekTo'];
const IGNORED_KEYS = ['page', 'limit'];

const ALLOWED_FILTERS = [
  ...TEXT_FILTERS,
  ...EXACT_FILTERS,
  ...WEEK_FILTERS,
  ...Object.keys(FILTER_ALIASES),
];

@Injectable()
export class PreparationService {
  constructor(
    @InjectModel(Preparation.name)
    private readonly preparationModel: Model<Preparation>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
  ) {}

  async create(
    createPreparationDto: CreatePreparationDto,
    userId: string,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const lecture = await this.lectureModel.findById(
      createPreparationDto.lecture,
    );
    if (!lecture) {
      throw new NotFoundException(
        `المحاضرة ذات المعرف ${createPreparationDto.lecture} غير موجودة`,
      );
    }

    let teacherId: string;
    let teacherName: string;

    if (user?.role === 'TEACHER') {
      // teacherId is nullable — an unassigned slot belongs to nobody, so a
      // teacher cannot prepare it either. Guard before calling toString().
      if (!lecture.teacherId || lecture.teacherId.toString() !== userId) {
        throw new ForbiddenException('المدرس لا يدرس هذه المحاضرة');
      }
      const teacher = await this.teacherModel.findById(userId);
      teacherId = userId;
      teacherName = teacher.name;
    } else {
      // Every non-teacher role files on behalf of whoever teaches the slot.
      // This used to name SUPERVISOR and OWNER explicitly, so a MANAGER fell
      // through both branches and the row saved with submittedBy: null.
      if (!lecture.teacherId) {
        throw new BadRequestException(
          `المحاضرة ${createPreparationDto.lecture} مش متسند لمدرس، فمينفعش يتعملها تحضير`,
        );
      }
      const teacher = await this.teacherModel.findById(lecture.teacherId);
      if (!teacher) {
        throw new NotFoundException(
          `المدرس غير موجود للمحاضرة ${createPreparationDto.lecture}`,
        );
      }
      teacherId = teacher._id.toString();
      teacherName = teacher.name;
    }

    const { weekOf: requestedWeek, ...preparationFields } =
      createPreparationDto as any;

    const savedPreparation = await new this.preparationModel({
      ...preparationFields,
      subject: lecture.subjectOfferingId,
      submittedBy: teacherId,
      name: teacherName,
      // Denormalised on purpose — see the note on the schema. The Friday cron
      // severs the lecture ref, so a join cannot answer "which class?" later.
      classId: lecture.classId ?? null,
      termId: lecture.termId ?? null,
      weekOf: requestedWeek ? startOfWeek(requestedWeek) : currentWeekOf(),
      isWeekEstimated: false,
    }).save();

  
    await this.lectureModel.findByIdAndUpdate(
      createPreparationDto.lecture,
      { $push: { preparation: savedPreparation._id } },
      { new: true }
    );

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (files && files.length > 0) {
      const preparationFolder = path.join(
        './uploads/preparation',
        savedPreparation._id.toString(),
      );

      if (!fs.existsSync(preparationFolder)) {
        fs.mkdirSync(preparationFolder, { recursive: true });
      }
      
      const movedFiles = [];

      for (const file of files) {
        const newPath = path.join(preparationFolder, file.filename);

        fs.renameSync(file.path, newPath);

        const relativePath = `/uploads/preparation/${savedPreparation._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

        movedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          url: fullUrl,
          size: file.size,
        });
      }

      savedPreparation.files = movedFiles;
      await savedPreparation.save();
    }

    const populatedPreparation = await this.preparationModel
      .findById(savedPreparation._id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'name academicYearId roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      populatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم إنشاء التحضير بنجاح',
      data: preparationWithUrls,
    };
  }

  /**
   * A teacher may only touch their own work. Everyone else who got past the
   * ability guard may touch anything in their school.
   *
   * `submittedBy` defaults to null (and was null on every row a MANAGER
   * created before the create() fix), so calling .toString() on it blindly —
   * as all four call sites used to — turned a permission check into a 500.
   */
  /**
   * Clears a review once the thing that was reviewed changes.
   *
   * Without this, a teacher could upload, get approved, then swap the PDF —
   * and the row would still read "approved" while pointing at a file nobody
   * ever looked at. Any content change sends it back to the queue.
   */
  private reviewResetFor(preparation: any) {
    if (!preparation?.reviewStatus || preparation.reviewStatus === 'pending') {
      return {};
    }
    return {
      reviewStatus: 'pending',
      reviewedBy: null,
      reviewedByName: '',
      reviewedAt: null,
      reviewNote: '',
    };
  }

  private assertCanMutate(preparation: any, user: any, action: string) {
    if (user?.role !== 'TEACHER') return;

    const owner = preparation?.submittedBy;
    if (!owner || owner.toString() !== user.userId) {
      throw new ForbiddenException(`ليس مسموحاً لك ب${action} هذا التحضير`);
    }
  }

  /**
   * Files one preparation per lecture in a single request.
   *
   * A teacher who teaches the same subject to three classes has three lectures
   * and therefore needs three preparations — that decision stands. What they
   * should not have to do is upload the same PDF three times, once per slot,
   * twenty-four times a week.
   *
   * Validation is all-or-nothing: every lecture is checked before anything is
   * written, so a bad id in the batch does not leave half of it created.
   * Lectures that already have a preparation for the week are reported as
   * skipped rather than duplicated.
   */
  async createBulk(
    dto: BulkCreatePreparationDto,
    user: any,
    req?: any,
    files?: Express.Multer.File[],
  ) {
    // Same lecture twice in one payload is a client slip, not two lessons.
    const lectureIds = [...new Set(dto.lectureIds.map(String))];
    const weekOf = dto.weekOf ? startOfWeek(dto.weekOf) : currentWeekOf();

    const lectures = await this.lectureModel
      .find({ _id: { $in: lectureIds } })
      .exec();

    const byId = new Map(lectures.map((l: any) => [String(l._id), l]));
    const missing = lectureIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `محاضرات غير موجودة: ${missing.join(', ')}`,
      );
    }

    if (user?.role === 'TEACHER') {
      const notMine = lectureIds.filter(
        (id) => String(byId.get(id).teacherId ?? '') !== String(user.userId),
      );
      if (notMine.length > 0) {
        throw new ForbiddenException(
          `المدرس لا يدرس المحاضرات: ${notMine.join(', ')}`,
        );
      }
    } else {
      const unassigned = lectureIds.filter((id) => !byId.get(id).teacherId);
      if (unassigned.length > 0) {
        throw new BadRequestException(
          `محاضرات مش متسندة لمدرس: ${unassigned.join(', ')}`,
        );
      }
    }

    const teacherIds = [
      ...new Set(lectures.map((l: any) => String(l.teacherId))),
    ];
    const teachers = await this.teacherModel
      .find({ _id: { $in: teacherIds } })
      .exec();
    const teacherById = new Map(teachers.map((t: any) => [String(t._id), t]));

    const unknownTeachers = teacherIds.filter((id) => !teacherById.has(id));
    if (unknownTeachers.length > 0) {
      throw new NotFoundException(
        `مدرسون غير موجودين: ${unknownTeachers.join(', ')}`,
      );
    }

    // One preparation per lecture per week; a second upload is almost always a
    // double-tap, so report it instead of quietly creating a duplicate.
    const existing = await this.preparationModel
      .find({ weekOf, lecture: { $in: lectureIds } })
      .select('_id lecture')
      .lean()
      .exec();
    const existingByLecture = new Map(
      existing.map((p: any) => [this.lectureKeyOf(p.lecture), p]),
    );

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const results: any[] = [];
    let created = 0;

    for (const lectureId of lectureIds) {
      const lecture: any = byId.get(lectureId);

      const alreadyThere = existingByLecture.get(lectureId);
      if (alreadyThere) {
        results.push({
          lectureId,
          status: 'skipped',
          reason: 'already_exists',
          preparationId: String(alreadyThere._id),
        });
        continue;
      }

      const teacher: any = teacherById.get(String(lecture.teacherId));

      const saved = await new this.preparationModel({
        lecture: lectureId,
        subject: lecture.subjectOfferingId,
        submittedBy: teacher._id,
        name: teacher.name,
        lessonTitle: dto.lessonTitle ?? '',
        classId: lecture.classId ?? null,
        termId: lecture.termId ?? null,
        weekOf,
        isWeekEstimated: false,
      }).save();

      await this.lectureModel.findByIdAndUpdate(lectureId, {
        $push: { preparation: saved._id },
      });

      if (files && files.length > 0) {
        // Copied, not moved: each preparation owns its files outright, so
        // deleting one does not empty the folders of its siblings.
        saved.files = this.copyFilesInto(saved._id.toString(), files);
        await saved.save();
      }

      created++;
      results.push({
        lectureId,
        status: 'created',
        preparationId: String(saved._id),
      });
    }

    this.discardTempFiles(files);

    const skipped = results.length - created;

    return {
      message:
        skipped === 0
          ? `تم إنشاء ${created} تحضير`
          : `تم إنشاء ${created} تحضير، و${skipped} كان موجود قبل كده`,
      weekOf: toDateOnlyString(weekOf),
      created,
      skipped,
      results,
    };
  }

  /** Copies the uploaded files into one preparation's own folder. */
  private copyFilesInto(preparationId: string, files: Express.Multer.File[]) {
    const folder = path.join('./uploads/preparation', preparationId);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    return files.map((file) => {
      const destination = path.join(folder, file.filename);
      fs.copyFileSync(file.path, destination);
      return {
        filename: file.filename,
        originalName: file.originalname,
        path: destination,
        size: file.size,
      };
    });
  }

  /**
   * The single-create path renames the upload out of temp; the bulk path
   * copies it, so the original has to be swept up afterwards or temp grows
   * without bound.
   */
  private discardTempFiles(files?: Express.Multer.File[]) {
    for (const file of files ?? []) {
      try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch {
        // A leftover temp file is not worth failing a successful batch over.
      }
    }
  }

  private addUrlsToFiles(preparation: any, baseUrl: string): any {
    const prepObj =
      typeof preparation.toObject === 'function'
        ? preparation.toObject()
        : preparation;

    if (prepObj.files && prepObj.files.length > 0) {
      prepObj.files = prepObj.files.map((file: any) => {
        const relativePath = `/uploads/preparation/${prepObj._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl,
        };
      });
    }

  
    if (prepObj.lecture && prepObj.lecture.classId && typeof prepObj.lecture.classId === 'object' && prepObj.lecture.classId._id) {
      const classData = prepObj.lecture.classId;
      prepObj.academicYear = classData.academicYear;
      prepObj.roomNumber = classData.roomNumber;
      prepObj.gender = classData.gender;
      prepObj.class = {
        _id: classData._id,
        academicYear: classData.academicYear,
        gender: classData.gender,
        roomNumber: classData.roomNumber,
      };

   
      prepObj.lecture = {
        ...prepObj.lecture,
        classId: classData._id.toString(),
      };
    }

    // The teacher picks a week; the day comes from the lecture. Surfacing the
    // resolved date means no client has to know that rule.
    const dayOfWeek =
      prepObj.lecture && typeof prepObj.lecture === 'object'
        ? prepObj.lecture.dayOfWeek
        : null;
    prepObj.weekOf = toDateOnlyString(prepObj.weekOf);
    prepObj.lessonDate = toDateOnlyString(
      lessonDateFor(
        prepObj.weekOf ? new Date(`${prepObj.weekOf}T00:00:00.000Z`) : null,
        dayOfWeek,
      ),
    );

    return prepObj;
  }

  /**
   * Turns query params into a Mongo filter, rejecting anything it does not
   * understand.
   *
   * The previous version assigned every unrecognised key straight into the
   * query (`query[key] = value`), so `?classId=x` — a field that does not
   * exist on this collection — matched nothing and came back as a cheerful
   * empty 200. "No results" and "no such filter" are very different answers.
   */
  private buildFilterQuery(filters: any, user?: any) {
    const query: any = {};
    const unknown: string[] = [];

    for (const [rawKey, value] of Object.entries(filters || {})) {
      if (value === undefined || value === null || value === '') continue;
      if (IGNORED_KEYS.includes(rawKey)) continue;

      if (!ALLOWED_FILTERS.includes(rawKey)) {
        unknown.push(rawKey);
        continue;
      }

      const key = FILTER_ALIASES[rawKey] ?? rawKey;
      const stringValue = String(value);

      if (TEXT_FILTERS.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (key === 'weekOf') {
        // Any day inside the week resolves to the same anchor, so the client
        // can send whatever date the user picked.
        query.weekOf = startOfWeek(stringValue);
      } else if (key === 'weekFrom' || key === 'weekTo') {
        query.weekOf = query.weekOf ?? {};
        if (typeof query.weekOf !== 'object' || query.weekOf instanceof Date) {
          // An exact weekOf was already given; a range on top of it is a
          // contradiction, so let the exact one win rather than build a
          // filter that silently matches nothing.
          continue;
        }
        query.weekOf[key === 'weekFrom' ? '$gte' : '$lte'] =
          startOfWeek(stringValue, key);
      } else {
        query[key] = stringValue;
      }
    }

    if (unknown.length > 0) {
      throw new BadRequestException(
        `فلتر غير معروف: ${unknown.join(', ')}. الفلاتر المتاحة: ${ALLOWED_FILTERS.join(', ')}`,
      );
    }

    // A teacher only ever sees their own, whatever they asked for.
    if (user?.role === 'TEACHER') {
      query.submittedBy = user.userId;
    }

    return query;
  }

  async filtering(
    filters: any,
    pagination: PaginationDto = {},
    user?: any,
    req?: any,
  ) {
    const query = this.buildFilterQuery(filters, user);

    const total = await this.preparationModel.countDocuments(query).exec();

    const paginationMate = getPagination(
      pagination.page,
      pagination.limit,
      total,
    );

    const isPaginationRequested =
      pagination.page !== undefined || pagination.limit !== undefined;

    let preparationsQuery = this.preparationModel
      .find(query).sort({ createdAt: -1 })
      .populate('submittedBy', 'name email');

    if (isPaginationRequested) {
      preparationsQuery = preparationsQuery
        .skip(paginationMate.skip)
        .limit(paginationMate.limit);
    }

    const preparations = await preparationsQuery.exec();

    //only populate lecture/subject for docs that still have ObjectId refs (not yet cleaned by cron)
    const toPopulate = preparations.filter(
      (p) => Types.ObjectId.isValid(p.lecture as any) && String(p.lecture).length === 24,
    );
    if (toPopulate.length > 0) {
      await this.preparationModel.populate(toPopulate, [
        { path: 'lecture', populate: { path: 'classId', select: 'name academicYearId roomNumber gender' } },
        { path: 'subject' },
      ]);
    }
    const toPopulateSubject = preparations.filter(
      (p) => !toPopulate.includes(p) && Types.ObjectId.isValid(p.subject as any) && String(p.subject).length === 24,
    );
    if (toPopulateSubject.length > 0) {
      await this.preparationModel.populate(toPopulateSubject, [{ path: 'subject' }]);
    }
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;
    
    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const preparationsWithUrls = preparations.map((preparation) =>
      this.addUrlsToFiles(preparation, baseUrl),
    );
  
    if (isPaginationRequested) {
      return {
        data: preparationsWithUrls,
        totalDocs,
        totalPages,
      };
    }

    return preparationsWithUrls;
  }

  /**
   * The weekly review screen.
   *
   * The plain list can only show what was submitted, which is the wrong half
   * of the question when you are reviewing a week — what a manager needs to
   * see is the gaps. So this starts from the teacher's timetable and hangs
   * each preparation off its slot, leaving `null` where nothing was filed.
   *
   * With `teacherId`: that teacher's full week, day by day.
   * Without it: one summary row per teacher, for a whole-school glance.
   */
  async getWeekly(
    params: { weekOf?: string; teacherId?: string; termId?: string },
    user: any,
    req?: any,
  ) {
    // A teacher asking about "the week" can only mean their own.
    const teacherId =
      user?.role === 'TEACHER' ? user.userId : params.teacherId || null;

    const weekOf = params.weekOf ? startOfWeek(params.weekOf) : currentWeekOf();

    const lectureFilter: any = {};
    if (teacherId) lectureFilter.teacherId = teacherId;
    else lectureFilter.teacherId = { $ne: null };
    if (params.termId) lectureFilter.termId = params.termId;

    const lectures = await this.lectureModel
      .find(lectureFilter)
      .populate('classId', 'name roomNumber gender academicYearId')
      .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
      .populate('teacherId', 'name email')
      .lean()
      .exec();

    const preparations = await this.preparationModel
      .find({
        weekOf,
        ...(teacherId ? { submittedBy: teacherId } : {}),
      })
      .lean()
      .exec();

    // A slot can only hold one preparation per week; last one filed wins.
    const byLecture = new Map<string, any>();
    for (const prep of preparations) {
      const key = this.lectureKeyOf(prep.lecture);
      if (key) byLecture.set(key, prep);
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (!teacherId) {
      return this.summariseByTeacher(lectures, byLecture, weekOf);
    }

    const days = WEEK_DAYS.map((day) => {
      const slots = lectures
        .filter((l: any) => l.dayOfWeek === day)
        .sort((a: any, b: any) => a.slot - b.slot)
        .map((l: any) => {
          const prep = byLecture.get(String(l._id));
          return {
            lectureId: String(l._id),
            slot: l.slot,
            class: l.classId
              ? {
                  _id: String(l.classId._id),
                  name: l.classId.name,
                  roomNumber: l.classId.roomNumber,
                  gender: l.classId.gender,
                }
              : null,
            subject: l.subjectOfferingId
              ? {
                  _id: String(l.subjectOfferingId._id),
                  name:
                    (l.subjectOfferingId as any)?.subjectId?.subjectName ??
                    null,
                }
              : null,
            preparation: prep
              ? this.addUrlsToFiles({ ...prep, lecture: l }, baseUrl)
              : null,
          };
        });

      return {
        dayOfWeek: day,
        date: toDateOnlyString(lessonDateFor(weekOf, day)),
        slots,
      };
    }).filter((d) => d.slots.length > 0);

    const total = lectures.length;
    const submitted = lectures.filter((l: any) =>
      byLecture.has(String(l._id)),
    ).length;

    const teacherDoc: any = lectures.find(
      (l: any) => l.teacherId && String(l.teacherId._id) === String(teacherId),
    )?.teacherId;

    return {
      weekOf: toDateOnlyString(weekOf),
      teacher: teacherDoc
        ? { _id: String(teacherDoc._id), name: teacherDoc.name }
        : { _id: String(teacherId), name: null },
      stats: {
        total,
        submitted,
        missing: total - submitted,
        pending: preparations.filter((p: any) => p.reviewStatus === 'pending')
          .length,
        needsRevision: preparations.filter(
          (p: any) => p.reviewStatus === 'needs_revision',
        ).length,
      },
      days,
    };
  }

  /**
   * `preparation.lecture` is an ObjectId until the Friday cleanup cron
   * replaces it with a snapshot object — both shapes point at the same
   * lecture, so both have to resolve to the same key.
   */
  private lectureKeyOf(lecture: any): string | null {
    if (!lecture) return null;
    if (typeof lecture === 'object') {
      return lecture._id ? String(lecture._id) : null;
    }
    return String(lecture);
  }

  private summariseByTeacher(
    lectures: any[],
    byLecture: Map<string, any>,
    weekOf: Date,
  ) {
    const rows = new Map<string, any>();

    for (const lecture of lectures) {
      const teacher = lecture.teacherId;
      if (!teacher) continue;
      const id = String(teacher._id ?? teacher);

      if (!rows.has(id)) {
        rows.set(id, {
          teacher: { _id: id, name: teacher.name ?? null },
          total: 0,
          submitted: 0,
          missing: 0,
        });
      }

      const row = rows.get(id);
      row.total += 1;
      if (byLecture.has(String(lecture._id))) row.submitted += 1;
    }

    const teachers = [...rows.values()].map((row) => ({
      ...row,
      missing: row.total - row.submitted,
      percentage: row.total === 0 ? 0 : Math.round((row.submitted / row.total) * 100),
    }));

    // Worst coverage first — that is who needs following up.
    teachers.sort((a, b) => a.percentage - b.percentage);

    return {
      weekOf: toDateOnlyString(weekOf),
      teachers,
      stats: {
        total: teachers.reduce((sum, t) => sum + t.total, 0),
        submitted: teachers.reduce((sum, t) => sum + t.submitted, 0),
        missing: teachers.reduce((sum, t) => sum + t.missing, 0),
      },
    };
  }

  /**
   * Records the review outcome on the preparation itself, so the next time
   * you open the week you can see where you got to — and so the teacher finds
   * out their sheet was sent back, with the reason, instead of by phone.
   */
  async review(
    id: string,
    dto: { reviewStatus: string; reviewNote?: string },
    user: any,
    req?: any,
  ) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      throw new ForbiddenException('المدرس لا يراجع تحاضيره بنفسه');
    }

    const updated = await this.preparationModel
      .findByIdAndUpdate(
        id,
        {
          reviewStatus: dto.reviewStatus,
          reviewNote: dto.reviewNote ?? '',
          reviewedBy: user?.userId ?? null,
          reviewedByName: user?.name ?? user?.email ?? '',
          reviewedAt: new Date(),
        },
        { new: true },
      )
      .populate('submittedBy', 'name email')
      .exec();

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    return {
      message: 'تم حفظ نتيجة المراجعة',
      data: this.addUrlsToFiles(updated, baseUrl),
    };
  }

  async update(
    id: string,
    updatePreparationDto: UpdatePreparationDto,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    this.assertCanMutate(preparation, user, 'تحديث');

    if (updatePreparationDto.lecture) {
      const newLecture = await this.lectureModel.findById(
        updatePreparationDto.lecture,
      );
      if (!newLecture) {
        throw new NotFoundException(
          `المحاضرة ذات المعرف ${updatePreparationDto.lecture} غير موجودة`,
        );
      }


      if (
        user?.role === 'TEACHER' &&
        String(newLecture.teacherId ?? '') !== user.userId
      ) {
        // teacherId is nullable, so .toString() on it turned an unassigned
        // slot into a 500 instead of a refusal.
        throw new ForbiddenException('المدرس لا يدرس هذه المحاضرة');
      }

      // After the Friday cron, `lecture` is a snapshot object rather than an
      // id. Calling .toString() on it yields "[object Object]", which never
      // matches — so the old id was then passed to findByIdAndUpdate as an
      // object and threw a CastError.
      const previousLectureId = this.lectureKeyOf(preparation.lecture);

      if (previousLectureId !== updatePreparationDto.lecture) {
        if (previousLectureId) {
          await this.lectureModel.findByIdAndUpdate(previousLectureId, {
            $pull: { preparation: id },
          });
        }

        await this.lectureModel.findByIdAndUpdate(
          updatePreparationDto.lecture,
          { $push: { preparation: id } },
        );
      }

      updatePreparationDto['subject'] = newLecture.subjectOfferingId;
      // Moving to another lecture moves the class and term with it.
      updatePreparationDto['classId'] = newLecture.classId ?? null;
      updatePreparationDto['termId'] = newLecture.termId ?? null;
    }

    if (updatePreparationDto.weekOf) {
      updatePreparationDto['weekOf'] = startOfWeek(
        updatePreparationDto.weekOf,
      ) as any;
      updatePreparationDto['isWeekEstimated'] = false;
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (files && files.length > 0) {
      const preparationFolder = path.join('./uploads/preparation', id);
      if (fs.existsSync(preparationFolder)) {
        fs.rmSync(preparationFolder, { recursive: true, force: true });
      }

      fs.mkdirSync(preparationFolder, { recursive: true });

      const newFiles = [];

      for (const file of files) {
        const newPath = path.join(preparationFolder, file.filename);

        fs.renameSync(file.path, newPath);

        newFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          size: file.size,
        });
      }

      updatePreparationDto['files'] = newFiles;
    }

    const touchesContent =
      updatePreparationDto['files'] !== undefined ||
      updatePreparationDto.lecture !== undefined ||
      updatePreparationDto.lessonTitle !== undefined;

    const updatedPreparation = await this.preparationModel
      .findByIdAndUpdate(
        id,
        {
          ...updatePreparationDto,
          ...(touchesContent ? this.reviewResetFor(preparation) : {}),
        },
        { new: true },
      )
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'name academicYearId roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم تحديث التحضير بنجاح',
      data: preparationWithUrls,
    };
  }

  async delete(id: string, user?: any) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    this.assertCanMutate(preparation, user, 'حذف');

    const preparationFolder = path.join('./uploads/preparation', id);
    if (fs.existsSync(preparationFolder)) {
      fs.rmSync(preparationFolder, { recursive: true, force: true });
    }

    await this.lectureModel.findByIdAndUpdate(
      preparation.lecture,
      { $pull: { preparation: id } },
      { new: true }
    );

    await this.preparationModel.findByIdAndDelete(id);
    return {
      message: `تم حذف التحضير ذو المعرف ${id} بنجاح`,
      data: preparation,
    };
  }

  async findOne(id: string, req?: any) {
    const preparation = await this.preparationModel
      .findById(id)
      .populate('submittedBy', 'name email')
      .exec();
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    //only populate lecture/subject if they are still ObjectId refs
    if (Types.ObjectId.isValid(preparation.lecture as any) && String(preparation.lecture).length === 24) {
      await this.preparationModel.populate(preparation, [
        { path: 'lecture', populate: { path: 'classId', select: 'name academicYearId roomNumber gender' } },
      ]);
    }
    if (Types.ObjectId.isValid(preparation.subject as any) && String(preparation.subject).length === 24) {
      await this.preparationModel.populate(preparation, [{ path: 'subject' }]);
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const preparationWithUrls = this.addUrlsToFiles(preparation, baseUrl);

    return preparationWithUrls;
  }

  async addFiles(
    id: string,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    this.assertCanMutate(preparation, user, 'إضافة ملفات ل');

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (!files || files.length === 0) {
      throw new BadRequestException('لم يتم توفير ملفات');
    }

    const preparationFolder = path.join('./uploads/preparation', id);

    if (!fs.existsSync(preparationFolder)) {
      fs.mkdirSync(preparationFolder, { recursive: true });
    }

    const existingFiles = preparation.files || [];

    for (const file of files) {
      const newPath = path.join(preparationFolder, file.filename);

      fs.renameSync(file.path, newPath);

      existingFiles.push({
        filename: file.filename,
        originalName: file.originalname,
        path: newPath,
        size: file.size,
      });
    }

    preparation.files = existingFiles;
    Object.assign(preparation, this.reviewResetFor(preparation));
    await preparation.save();

    const updatedPreparation = await this.preparationModel
      .findById(id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'name academicYearId roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم إضافة الملفات بنجاح',
      data: preparationWithUrls,
    };
  }

  async removeFile(id: string, filename: string, user?: any, req?: any) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    this.assertCanMutate(preparation, user, 'إزالة ملفات من');

    const fileIndex = preparation.files.findIndex(
      (file) => file.filename === filename,
    );

    if (fileIndex === -1) {
      throw new NotFoundException(`الملف ${filename} غير موجود في التحضير`);
    }

    const fileToRemove = preparation.files[fileIndex];
    const filePath = fileToRemove.path;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    preparation.files.splice(fileIndex, 1);
    Object.assign(preparation, this.reviewResetFor(preparation));
    await preparation.save();

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    const updatedPreparation = await this.preparationModel
      .findById(id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'name academicYearId roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: `تم إزالة الملف ${filename} بنجاح`,
      data: preparationWithUrls,
    };
  }
}
