import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DailyTracking } from './schemas/daily-tracking.schema';
import { BulkDailyTrackingDto, DailyTrackingRecordDto } from './dto/bulk-daily-tracking.dto';
import { TrackingSummaryQueryDto } from './dto/tracking-summary-query.dto';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Student } from '../students/schemas/student.schema';
import { Attendance } from '../attendance/schemas/attendance.schema';
import { AttendanceService } from '../attendance/attendance.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { Substitution } from '../duty/schemas/substitution.schema';
import { coversLecture } from '../duty/substitute-access.util';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { ACTIVITY_NOT_TRACKED, isActivityLecture } from '../subjects/activity.util';

/** What one student's row resolves to once defaults are applied. */
export interface ResolvedTrackingRecord {
  studentId: string;
  absent: boolean;
  participation: boolean;
  homework: boolean;
  quiz: boolean | null;
}

@Injectable()
export class DailyTrackingService {
  private readonly logger = new Logger(DailyTrackingService.name);

  constructor(
    @InjectModel(DailyTracking.name)
    private readonly trackingModel: Model<DailyTracking>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
    @InjectModel(Attendance.name)
    private readonly attendanceModel: Model<Attendance>,
    // forwardRef on this side too: the two modules reference each other, so
    // without it AttendanceService is undefined here at runtime and Nest
    // fails to resolve the constructor.
    @Inject(forwardRef(() => AttendanceService))
    private readonly attendanceService: AttendanceService,
    // A substitute covering the period today may record its tracking.
    @Optional()
    @InjectModel(Substitution.name)
    private readonly substitutionModel?: Model<Substitution>,
  ) {}

  /**
   * Apply the defaults once, on the server.
   *
   * The sheet opens with attendance, participation and homework ticked, so a
   * teacher only unticks. If each client invented that default for itself,
   * web and mobile would eventually disagree about what an omitted field
   * means — so the rule lives here and the clients send what they were shown.
   */
  static resolveRecord(record: DailyTrackingRecordDto): ResolvedTrackingRecord {
    const absent = record.absent === true;

    // A student who was not there did not participate and did not bring her
    // work. Leaving those ticked because nobody unticked them writes a
    // pleasant fiction into the monthly report.
    if (absent) {
      return {
        studentId: String(record.studentId),
        absent: true,
        participation: false,
        homework: false,
        quiz: null,
      };
    }

    return {
      studentId: String(record.studentId),
      absent: false,
      participation: record.participation !== false,
      homework: record.homework !== false,
      // Only an explicit true/false is a quiz result; anything else is "no
      // quiz today" and must stay null rather than collapsing to false.
      quiz: typeof record.quiz === 'boolean' ? record.quiz : null,
    };
  }

  /** An ObjectId, or null when the value is absent or malformed. */
  private static toObjectId(value: unknown): mongoose.Types.ObjectId | null {
    const raw = String(value ?? '');
    return mongoose.Types.ObjectId.isValid(raw)
      ? new mongoose.Types.ObjectId(raw)
      : null;
  }

  /**
   * The lecture, with the teacher's claim to it checked.
   *
   * Mirrors the rule `getLectureSheet` applies when reading. This endpoint
   * writes, so the same check matters more here, not less.
   */
  private async loadLectureForTeacher(lectureId: string, user: any, date?: string) {
    if (!mongoose.Types.ObjectId.isValid(lectureId)) {
      throw new BadRequestException('معرّف الحصة غير صالح');
    }

    const lecture = await this.lectureModel
      .findById(lectureId)
      .populate('classId', 'name')
      .populate({
        path: 'subjectOfferingId',
        populate: [{ path: 'subjectId', select: 'subjectName isActivity' }],
      })
      .exec();

    if (!lecture) throw new NotFoundException('الحصة غير موجودة');
    // Breakfast, play: on the timetable, never tracked.
    if (isActivityLecture(lecture)) throw new BadRequestException(ACTIVITY_NOT_TRACKED);

    const lectureTeacherId = (lecture as any).teacherId?._id ?? (lecture as any).teacherId;
    if (
      user?.role === 'TEACHER' &&
      String(lectureTeacherId ?? '') !== String(user.userId) &&
      // The substitute sent to cover this period on this day may record it.
      !(date && (await coversLecture(this.substitutionModel, user.userId, lectureId, date)))
    ) {
      throw new ForbiddenException('هذه ليست حصتك');
    }

    return lecture;
  }

  /**
   * Every student who may appear on this lecture's sheet.
   *
   * Reads `student.classId`, which is what `getLectureSheet` reads. The rest
   * of the platform resolves rosters through `enrollments`, and the mismatch
   * has bitten before — but changing the source here would silently change
   * who can be marked absent, so both callers stay on one source until that
   * is unified deliberately.
   */
  private async rosterIds(classId: mongoose.Types.ObjectId | string): Promise<Set<string>> {
    const students = await this.studentModel
      .find({ classId, isActive: true })
      .select('_id')
      .exec();
    return new Set(students.map((s: any) => String(s._id)));
  }

  /**
   * Record a whole period in one call.
   *
   * The three behavioural fields are written here; attendance is routed to
   * AttendanceService so the family notification and the excuse flow keep
   * working. The client sends one payload because the teacher pressed save
   * once — splitting it into two requests would let one half succeed.
   */
  /**
   * The bulk route skips its permission guard for MANAGER and lands here: a
   * manager records daily tracking if her permissions allow it, or for the
   * period she is covering that day. Managers have dailyTracking.add off by
   * default, and without this a manager sent to cover could take the
   * register but not the tracking for the same period.
   */
  private async assertManagerMayRecord(dto: BulkDailyTrackingDto, user: any) {
    if (user?.role !== 'MANAGER') return;

    const ability = await new CaslAbilityFactory().defineAbilitiesFor(user);
    if (ability.can('create', 'DailyTracking')) return;

    if (await coversLecture(this.substitutionModel, user.userId, dto.lectureId, dto.date)) {
      return;
    }

    throw new ForbiddenException('ليس لديك صلاحية للقيام بهذا الإجراء');
  }

  async bulkUpsert(dto: BulkDailyTrackingDto, user: any) {
    await this.assertManagerMayRecord(dto, user);
    const lecture = await this.loadLectureForTeacher(dto.lectureId, user, dto.date);

    const classId = (lecture as any).classId?._id ?? (lecture as any).classId;
    const offering = (lecture as any).subjectOfferingId;
    const date = this.parseSchoolDate(dto.date);

    const records = dto.records.map((r) => DailyTrackingService.resolveRecord(r));

    // One student twice in one payload would make the bulkWrite order decide
    // which wins — silently, and differently on a retry.
    const seen = new Set<string>();
    for (const r of records) {
      if (seen.has(r.studentId)) {
        throw new BadRequestException('تكرر معرّف طالبة أكثر من مرة في الطلب');
      }
      seen.add(r.studentId);
    }

    // Without this a teacher could edit the payload and write a record for
    // any student in the school, including one she does not teach.
    const roster = await this.rosterIds(classId);
    const strangers = records.filter((r) => !roster.has(r.studentId));
    if (strangers.length > 0) {
      throw new BadRequestException(
        `${strangers.length} من الطالبات لا ينتمين إلى فصل هذه الحصة`,
      );
    }

    const schoolId = this.requireSchoolId();
    const denormalised = {
      classId: new mongoose.Types.ObjectId(String(classId)),
      subjectOfferingId: offering?._id ?? offering ?? null,
      teacherId: (lecture as any).teacherId?._id ?? (lecture as any).teacherId ?? null,
      subjectName: offering?.subjectId?.subjectName ?? '',
      className: (lecture as any).classId?.name ?? '',
      // Tolerant on purpose: an id that will not cast is worth losing, and
      // is not worth throwing a BSONError over a sheet the teacher just
      // filled in. The row is the point; its author is a courtesy.
      recordedBy: DailyTrackingService.toObjectId(user?.userId),
    };

    // bulkWrite is NOT covered by tenantScopedPlugin — its hooks are on the
    // query and document paths only. Every filter and insert below therefore
    // carries schoolId explicitly; omitting it would write rows that leak
    // across schools and match another school's documents.
    await this.trackingModel.bulkWrite(
      records.map((r) => ({
        updateOne: {
          filter: {
            schoolId,
            studentId: new mongoose.Types.ObjectId(r.studentId),
            lectureId: new mongoose.Types.ObjectId(String(dto.lectureId)),
            date,
          },
          update: {
            $set: {
              participation: r.participation,
              homework: r.homework,
              quiz: r.quiz,
              ...denormalised,
            },
            $setOnInsert: {
              schoolId,
              studentId: new mongoose.Types.ObjectId(r.studentId),
              lectureId: new mongoose.Types.ObjectId(String(dto.lectureId)),
              date,
            },
          },
          upsert: true,
        },
      })),
    );

    const attendance = await this.syncAttendance(records, String(classId), dto.date, user);

    return {
      status: true,
      message: 'تم حفظ سجل المتابعة',
      data: {
        lectureId: dto.lectureId,
        date: dto.date,
        saved: records.length,
        attendance,
      },
    };
  }

  /**
   * Bring the attendance collection in line with the sheet — by difference.
   *
   * Deliberately not "delete today's absences and re-insert": an absence
   * carries the family's written excuse and the manager's review of it, and
   * deleting the row to rewrite it destroys evidence nobody can recover.
   * Only genuinely new absences are created, only lifted ones removed.
   */
  private async syncAttendance(
    records: ResolvedTrackingRecord[],
    classId: string,
    date: string,
    user: any,
  ) {
    const day = this.parseSchoolDate(date);
    const shouldBeAbsent = new Set(
      records.filter((r) => r.absent).map((r) => r.studentId),
    );

    const existing = await this.attendanceModel
      .find({ classId: new mongoose.Types.ObjectId(classId), date: day })
      .select('_id studentId')
      .exec();
    const alreadyAbsent = new Map(
      existing.map((a: any) => [String(a.studentId), a]),
    );

    const toCreate = [...shouldBeAbsent].filter((id) => !alreadyAbsent.has(id));
    const toLift = [...alreadyAbsent.keys()].filter(
      // Only students on this sheet. A student the payload never mentioned
      // keeps whatever another period already recorded.
      (id) => !shouldBeAbsent.has(id) && records.some((r) => r.studentId === id),
    );

    let created = 0;
    let lifted = 0;
    const failures: string[] = [];

    for (const studentId of toCreate) {
      try {
        // Through the service, not the model: this is what notifies the
        // family and opens the excuse they are being asked for.
        await this.attendanceService.create({ studentId, classId, date }, user);
        created++;
      } catch (error: any) {
        // One student's notification failing must not discard the other
        // twenty-nine rows the teacher just recorded.
        this.logger.error(
          `Could not record absence for ${studentId} on ${date}: ${error?.message}`,
        );
        failures.push(studentId);
      }
    }

    for (const studentId of toLift) {
      try {
        await this.attendanceService.delete(String(alreadyAbsent.get(studentId)._id), user);
        lifted++;
      } catch (error: any) {
        this.logger.error(
          `Could not lift absence for ${studentId} on ${date}: ${error?.message}`,
        );
        failures.push(studentId);
      }
    }

    return { created, lifted, failed: failures.length };
  }

  /**
   * Today's tracking for one lecture, keyed by student id.
   *
   * Used by the attendance sheet so one call still answers the whole screen.
   */
  async forLecture(lectureId: string, date: string | Date) {
    const day = this.parseSchoolDate(date);
    const rows = await this.trackingModel
      .find({ lectureId: new mongoose.Types.ObjectId(String(lectureId)), date: day })
      .select('studentId participation homework quiz')
      .lean()
      .exec();

    return new Map(
      rows.map((row: any) => [
        String(row.studentId),
        {
          participation: row.participation !== false,
          homework: row.homework !== false,
          quiz: typeof row.quiz === 'boolean' ? row.quiz : null,
        },
      ]),
    );
  }

  /**
   * Per-student totals for a class over a date range.
   *
   * Behavioural only — no grade appears here and none is derived. The rates
   * are read against `presentDays`, not the whole range: a student cannot
   * participate on a day she was not there, and dividing by days she missed
   * would report her as disengaged for being ill.
   */
  async summary(query: TrackingSummaryQueryDto, user: any) {
    const start = this.parseSchoolDate(query.startDate);
    const end = this.parseSchoolDate(query.endDate);
    if (start > end) {
      throw new BadRequestException('startDate بعد endDate');
    }

    await this.assertMayReadClass(query.classId, user);

    const schoolId = this.requireSchoolId();
    const match: any = {
      schoolId,
      classId: new mongoose.Types.ObjectId(query.classId),
      date: { $gte: start, $lte: end },
    };
    if (query.subjectOfferingId) {
      match.subjectOfferingId = new mongoose.Types.ObjectId(query.subjectOfferingId);
    }

    // Absence lives in the attendance collection, not here — there is no
    // `absent` field on a tracking row, deliberately, so that "was she here?"
    // has one answer. Presence is resolved by looking for an absence record
    // on the same student and day; no match means she was there.
    const rows = await this.trackingModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'attendance',
          let: { s: '$studentId', d: '$date' },
          pipeline: [
            {
              $match: {
                // schoolId inside the sub-pipeline too: $lookup runs raw and
                // the tenant plugin does not reach into it.
                $expr: {
                  $and: [
                    { $eq: ['$schoolId', schoolId] },
                    { $eq: ['$studentId', '$$s'] },
                    { $eq: ['$date', '$$d'] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'absence',
        },
      },
      { $addFields: { present: { $eq: [{ $size: '$absence' }, 0] } } },
      {
        $group: {
          _id: '$studentId',
          totalLectures: { $sum: 1 },
          presentCount: { $sum: { $cond: ['$present', 1, 0] } },
          // Counted only on days she was present, so the denominator below
          // is the same population as the numerator.
          participationCount: {
            $sum: {
              $cond: [{ $and: ['$present', { $eq: ['$participation', true] }] }, 1, 0],
            },
          },
          homeworkCount: {
            $sum: {
              $cond: [{ $and: ['$present', { $eq: ['$homework', true] }] }, 1, 0],
            },
          },
          quizPassed: { $sum: { $cond: [{ $eq: ['$quiz', true] }, 1, 0] } },
          quizFailed: { $sum: { $cond: [{ $eq: ['$quiz', false] }, 1, 0] } },
          // Everything that is neither true nor false: no quiz was held.
          // Matching on null alone would miss a row where the field is absent.
          quizNone: {
            $sum: {
              $cond: [{ $in: ['$quiz', [true, false]] }, 0, 1],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'students',
          localField: '_id',
          foreignField: '_id',
          as: 'student',
        },
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          studentId: '$_id',
          studentName: { $ifNull: ['$student.name', ''] },
          totalLectures: 1,
          presentCount: 1,
          absentCount: { $subtract: ['$totalLectures', '$presentCount'] },
          participationCount: 1,
          homeworkCount: 1,
          // null rather than 0 when she was never present: "no data" is not
          // "zero percent", and a report that cannot tell them apart invites
          // a conversation about a student who was simply away.
          participationRate: this.rateOf('$participationCount'),
          homeworkRate: this.rateOf('$homeworkCount'),
          quizzes: {
            passed: '$quizPassed',
            failed: '$quizFailed',
            noQuiz: '$quizNone',
          },
        },
      },
      { $sort: { studentName: 1 } },
    ]);

    return {
      status: true,
      message: 'تم استرجاع تقرير المتابعة',
      data: {
        classId: query.classId,
        subjectOfferingId: query.subjectOfferingId ?? null,
        startDate: query.startDate,
        endDate: query.endDate,
        studentCount: rows.length,
        // Says plainly what this report is, so nobody downstream reads the
        // percentages as marks.
        note: 'رصد سلوكي — لا يؤثر في الدرجات',
        students: rows,
      },
    };
  }

  /** A percentage of the days she was present, or null when there were none. */
  private rateOf(countField: string) {
    return {
      $cond: [
        { $gt: ['$presentCount', 0] },
        {
          $round: [
            { $multiply: [{ $divide: [countField, '$presentCount'] }, 100] },
            1,
          ],
        },
        null,
      ],
    };
  }

  /**
   * Who may read a class's report.
   *
   * Managers and owners: any class. A teacher: only a class she actually
   * teaches, which is checked against the timetable rather than a permission
   * flag — the flag says she may read reports, not whose.
   */
  private async assertMayReadClass(classId: string, user: any) {
    if (user?.role !== 'TEACHER') return;

    // An id that will not cast can match no lecture, so it is a refusal —
    // not a BSONError surfacing as a 500 from a report screen.
    const teacherId = DailyTrackingService.toObjectId(user.userId);
    if (!teacherId) {
      throw new ForbiddenException('لا يمكنك عرض تقرير فصل لا تُدرّس له');
    }

    const lecture = await this.lectureModel
      .findOne({
        classId: new mongoose.Types.ObjectId(classId),
        teacherId,
      })
      .select('_id')
      .exec();

    if (!lecture) {
      throw new ForbiddenException('لا يمكنك عرض تقرير فصل لا تُدرّس له');
    }
  }

  /**
   * A calendar day, parsed the way the rest of the platform parses one.
   *
   * `YYYY-MM-DD` at UTC midnight, matching how attendance already stores
   * dates, so the two collections agree on what "the 29th" means.
   */
  private parseSchoolDate(value: string | Date): Date {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new BadRequestException('التاريخ غير صالح');
      }
      return value;
    }

    const raw = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('التاريخ يجب أن يكون بصيغة YYYY-MM-DD');
    }

    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('التاريخ غير صالح');
    }
    return parsed;
  }

  /**
   * bulkWrite bypasses the tenant plugin, so the caller's school has to be
   * read here. Failing loudly beats writing rows with no schoolId, which
   * would be invisible to every scoped query afterwards.
   */
  private requireSchoolId(): mongoose.Types.ObjectId {
    const schoolId = tenantLocalStorage.getStore()?.schoolId;
    if (!schoolId) {
      throw new ForbiddenException('لا يمكن تحديد المدرسة الحالية');
    }
    return new mongoose.Types.ObjectId(schoolId);
  }
}
