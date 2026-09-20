import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { Attendance } from './schemas/attendance.schema';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Term } from '../terms/schemas/term.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { NotificationsService } from 'src/notifications/notifications.service';
import { transformAttendanceResponse } from './transforms/response.transform';
import { Admin } from '../admin/schemas/admin.schema';
import {
  ListAbsenceExcusesDto,
  ReviewAbsenceExcuseDto,
  SubmitAbsenceExcuseDto,
} from './dto/absence-excuse.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  // Constants for populate field selections
  private static readonly STUDENT_FIELDS = 'name schoolEmail academicYear';
  private static readonly CLASS_FIELDS = 'roomNumber academicYear';
  private static readonly CLASS_FIELDS_GENDER = 'roomNumber academicYear gender';
  private static readonly DETAILED_STUDENT_FIELDS = 'firstName familyName name schoolEmail';

  constructor(
    @InjectModel(Attendance.name)
    private readonly attendanceModel: Model<Attendance>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Term.name)
    private readonly termModel: Model<Term>,
    @InjectModel(Admin.name)
    private readonly adminModel: Model<Admin>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Everyone at the school who should see a family's answer.
   *
   * Sent to all of them rather than to whoever recorded the absence: the
   * teacher who marked the register at eight is not the person who decides
   * whether a medical note is accepted.
   */
  private async schoolAdminIds(schoolId: any): Promise<string[]> {
    if (!schoolId) return [];

    const admins = await this.adminModel
      .find({
        schoolId: new mongoose.Types.ObjectId(String(schoolId)),
        role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] },
      })
      .select('_id')
      .setOptions({ skipTenantScope: true })
      .lean()
      .exec();

    return admins.map((admin: any) => String(admin._id));
  }

  /**
   * Tell the student their absence was recorded today.
   *
   * The parent is the real reader. They sign in as their child, and until now
   * the only way to learn of an absence was to go looking for it on a screen
   * they had no reason to open — so a family found out on report day, weeks
   * after anything could be done. The notice arrives the same morning.
   *
   * Never throws: an absence that was recorded must not be rolled back because
   * a notice could not be written.
   */
  private async announceAbsence(attendance: any, student: any, classData: any) {
    const date = new Date(attendance.date);
    const dateLabel = date.toISOString().slice(0, 10);

    try {
      const studentName = student?.name ?? 'الطالب/ة';

      await this.notifications.notify({
        recipientId: attendance.studentId,
        type: 'student_absent',
        title: `ولي أمر/الطالبة: ${studentName}`,
        // The school's own wording. It asks for something, so the client must
        // offer somewhere to answer — see submitExcuse below.
        body:
          'نأمل إيضاح سبب غياب ابنكم/ابنتكم عن المدرسة لهذا اليوم، ' +
          'مع إرفاق العذر الطبي في حال وجوده.\n\nشاكرين لكم تعاونكم 🌷',
        data: {
          attendanceId: String(attendance._id),
          studentId: String(attendance.studentId),
          studentName,
          classId: String(attendance.classId),
          className: classData?.name ?? '',
          date: dateLabel,
          // What the client needs to know it should show the excuse form.
          excuseRequested: true,
        },
      });
    } catch (error: any) {
      // The record is the point. Rolling back an absence because a message
      // failed would delete a fact to save a courtesy.
      this.logger.error(`Could not announce absence ${attendance._id}: ${error?.message}`);
    }
  }

  // ───────────────────────────────────────────────── absence excuses

  /**
   * Absences this family has not explained yet.
   *
   * Recent rather than today only: a child off sick for three days is
   * answered once, when somebody finally opens the app, and the other two
   * days must still be there to answer.
   */
  async pendingExcuses(user: any, days = 14) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await this.attendanceModel
      .find({
        studentId: new mongoose.Types.ObjectId(String(user.userId)),
        date: { $gte: since },
        excuse: null,
      })
      .populate('classId', AttendanceService.CLASS_FIELDS)
      .sort({ date: -1 })
      .lean()
      .exec();

    return {
      status: true,
      data: {
        pending: rows.length > 0,
        count: rows.length,
        items: rows.map((row: any) => ({
          attendanceId: String(row._id),
          date: new Date(row.date).toISOString().slice(0, 10),
          className: row.classId?.name ?? row.name ?? '',
        })),
      },
    };
  }

  /**
   * The family's answer, sent on to the school.
   *
   * Written once, like the teacher's account of a lateness: an explanation a
   * manager has already read and acted on cannot be quietly rewritten
   * afterwards. A correction is a conversation, not an edit.
   */
  async submitExcuse(user: any, dto: SubmitAbsenceExcuseDto) {
    const record = await this.attendanceModel.findById(dto.attendanceId);
    if (!record) throw new NotFoundException('سجل الغياب غير موجود');

    // The record must be this student's. Without this any signed-in family
    // could explain away another child's absence.
    if (String(record.studentId) !== String(user.userId)) {
      throw new ForbiddenException('هذا السجل ليس لك');
    }

    if (record.excuse) {
      throw new ConflictException('تم إرسال عذر لهذا اليوم بالفعل');
    }

    const reason = dto.reason.trim();
    record.excuse = reason;
    record.excuseAt = new Date();
    record.excuseAttachment = dto.attachment?.trim() || null;
    record.excuseStatus = 'pending';
    await record.save();

    const dateLabel = new Date(record.date).toISOString().slice(0, 10);
    const student = await this.studentModel
      .findById(record.studentId)
      .select('name')
      .lean()
      .exec();
    const studentName = (student as any)?.name ?? 'الطالب/ة';

    // Never let a failed notice undo a submitted excuse — the family would be
    // told to write it again, and would be right to stop bothering.
    try {
      const admins = await this.schoolAdminIds(user.schoolId);
      await Promise.all(
        admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'absence_excuse_submitted',
            title: `عذر غياب: ${studentName}`,
            body: `${dateLabel} — ${reason}${record.excuseAttachment ? ' (مرفق)' : ''}`,
            data: {
              attendanceId: String(record._id),
              studentId: String(record.studentId),
              studentName,
              date: dateLabel,
              reason,
              hasAttachment: Boolean(record.excuseAttachment),
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(`Could not announce excuse ${record._id}: ${error?.message}`);
    }

    return {
      status: true,
      message: 'تم إرسال العذر إلى إدارة المدرسة',
      data: {
        attendanceId: String(record._id),
        date: dateLabel,
        excuse: record.excuse,
        excuseAt: record.excuseAt,
        excuseAttachment: record.excuseAttachment,
        excuseStatus: record.excuseStatus,
      },
    };
  }

  /**
   * The manager's queue.
   *
   * Defaults to what is waiting: the list exists to be emptied, and opening it
   * on every excuse ever sent buries the three that need a decision today.
   */
  async listExcuses(filters: ListAbsenceExcusesDto, pagination: PaginationDto) {
    const query: any = { excuse: { $ne: null } };
    query.excuseStatus = filters.status ?? 'pending';

    if (filters.classId) {
      query.classId = new mongoose.Types.ObjectId(filters.classId);
    }
    if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = new Date(filters.from);
      if (filters.to) query.date.$lte = new Date(filters.to);
    }

    // Count first: the page maths needs the total, and a page number past the
    // end should come back empty rather than as a negative skip.
    const total = await this.attendanceModel.countDocuments(query).exec();
    const { skip, limit, ...meta } = getPagination(
      pagination?.page as any,
      pagination?.limit as any,
      total,
    );

    const rows = await this.attendanceModel
      .find(query)
      .populate('studentId', AttendanceService.DETAILED_STUDENT_FIELDS)
      .populate('classId', AttendanceService.CLASS_FIELDS)
      .sort({ excuseAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      status: true,
      data: {
        ...meta,
        limit,
        total,
        items: rows.map((row: any) => ({
          attendanceId: String(row._id),
          date: new Date(row.date).toISOString().slice(0, 10),
          studentName: row.studentId?.name ?? row.name ?? '',
          className: row.classId?.name ?? '',
          excuse: row.excuse,
          excuseAt: row.excuseAt,
          excuseAttachment: row.excuseAttachment,
          excuseStatus: row.excuseStatus,
          excuseReviewedByName: row.excuseReviewedByName,
          excuseReviewedAt: row.excuseReviewedAt,
          excuseReviewNote: row.excuseReviewNote,
        })),
      },
    };
  }

  /**
   * Accept or refuse an excuse, and tell the family which.
   *
   * The verdict travels back on purpose. A school that collects explanations
   * and answers none teaches families that the form is decoration.
   */
  async reviewExcuse(id: string, user: any, dto: ReviewAbsenceExcuseDto) {
    const record = await this.attendanceModel.findById(id);
    if (!record) throw new NotFoundException('سجل الغياب غير موجود');
    if (!record.excuse) throw new BadRequestException('لا يوجد عذر لمراجعته');
    if (record.excuseStatus && record.excuseStatus !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا العذر بالفعل');
    }

    const note = (dto.note ?? '').trim();
    if (dto.verdict === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض العذر');
    }

    record.excuseStatus = dto.verdict;
    record.excuseReviewedBy = new mongoose.Types.ObjectId(String(user.userId));
    record.excuseReviewedByName = user.name ?? '';
    record.excuseReviewedAt = new Date();
    record.excuseReviewNote = note;
    await record.save();

    const dateLabel = new Date(record.date).toISOString().slice(0, 10);
    const accepted = dto.verdict === 'accepted';

    try {
      await this.notifications.notify({
        recipientId: record.studentId,
        type: 'absence_excuse_reviewed',
        title: accepted ? 'تم قبول عذر الغياب' : 'لم يُقبل عذر الغياب',
        body: [
          `غياب ${dateLabel}`,
          note || (accepted ? 'شاكرين لكم تعاونكم 🌷' : null),
        ]
          .filter(Boolean)
          .join(' — '),
        data: {
          attendanceId: String(record._id),
          date: dateLabel,
          excuseStatus: record.excuseStatus,
          note,
        },
      });
    } catch (error: any) {
      this.logger.error(`Could not announce verdict on ${record._id}: ${error?.message}`);
    }

    return {
      status: true,
      message: accepted ? 'تم قبول العذر' : 'تم رفض العذر',
      data: {
        attendanceId: String(record._id),
        excuseStatus: record.excuseStatus,
        excuseReviewNote: record.excuseReviewNote,
        excuseReviewedAt: record.excuseReviewedAt,
      },
    };
  }

  // Index matches Date.getUTCDay(): 0 = Sunday
  private static readonly WEEKDAYS = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ];

  /**
   * A teacher may only record attendance for a class they actually teach that day.
   * Admins are unrestricted.
   *
   * Attendance is day-level, so whoever opens their lecture first records the day —
   * every later teacher of the same class hits the duplicate guard instead.
   */
  private async assertMayRecordForClass(user: any, classId: string, date: string | Date) {
    if (!user || user.role !== 'TEACHER') return;

    const day = new Date(date);
    const weekday = AttendanceService.WEEKDAYS[day.getUTCDay()];

    const filter: any = {
      classId: new mongoose.Types.ObjectId(classId),
      teacherId: new mongoose.Types.ObjectId(String(user.userId)),
      dayOfWeek: weekday,
    };

    // Scope to the term the date falls in, so last term's timetable does not
    // keep granting access. If the date sits outside every term, stay lenient.
    const term = await this.termModel
      .findOne({ startDate: { $lte: day }, endDate: { $gte: day } })
      .select('_id')
      .exec();
    if (term) filter.termId = term._id;

    const lecture = await this.lectureModel.findOne(filter).exec();
    if (!lecture) {
      throw new ForbiddenException(
        'لا يمكنك تسجيل الغياب لهذا الفصل — ليس لديك حصة في جدول هذا اليوم',
      );
    }
  }

  /**
   * A teacher may only edit or delete a record for a class they teach on that
   * record's own date — the same rule as recording it. Admins are unrestricted.
   *
   * Deleting is how a teacher undoes a mistake: attendance is absence-based, so
   * removing the record is what marks the student present again. Without this
   * check, granting teachers delete would let any teacher clear any absence in
   * the school, which is why the permission and the check ship together.
   */
  private async assertMayTouchRecord(user: any, attendanceId: string) {
    if (!user || user.role !== 'TEACHER') return;

    const record = await this.attendanceModel
      .findById(attendanceId)
      .select('classId date')
      .exec();

    // Missing record is not this method's error to report — let the caller's
    // own lookup raise the 404 so the message stays consistent.
    if (!record) return;

    const classId = String((record as any).classId?._id ?? (record as any).classId);
    await this.assertMayRecordForClass(user, classId, (record as any).date);
  }

  /**
   * Everything the attendance screen needs for one lecture, in a single call:
   * the lecture, its class, the full student roster, and who is already marked
   * absent for that date.
   */
  async getLectureSheet(lectureId: string, date: string, user?: any) {
    this.validateObjectId(lectureId, 'Lecture ID');

    const lecture = await this.lectureModel
      .findById(lectureId)
      .populate('classId', 'name roomNumber gender')
      .populate({
        path: 'subjectOfferingId',
        populate: [{ path: 'subjectId', select: 'subjectName subjectCode' }],
      })
      .populate('teacherId', 'name')
      .exec();

    if (!lecture) {
      throw new NotFoundException('المحاضرة غير موجودة');
    }

    if (
      user?.role === 'TEACHER' &&
      String((lecture as any).teacherId?._id ?? (lecture as any).teacherId) !==
        String(user.userId)
    ) {
      throw new ForbiddenException('هذه ليست حصتك');
    }

    const classId = (lecture as any).classId?._id ?? (lecture as any).classId;
    const day = new Date(date);

    const [students, absences] = await Promise.all([
      this.studentModel
        .find({ classId, isActive: true })
        .select('name firstName familyName schoolEmail')
        .sort({ name: 1 })
        .exec(),
      this.attendanceModel.find({ classId, date: day }).select('studentId').exec(),
    ]);

    const absentIds = new Set(absences.map((a) => a.studentId.toString()));

    return {
      message: 'تم استرجاع كشف الحضور بنجاح',
      data: {
        lecture,
        date,
        alreadyRecorded: absences.length > 0,
        students: students.map((s: any) => ({
          _id: s._id,
          name: s.name,
          schoolEmail: s.schoolEmail,
          absent: absentIds.has(s._id.toString()),
        })),
      },
    };
  }

  /**
   * Creates a new attendance record
   * Validates student and class existence, checks for duplicates, and creates attendance
   */
  async create(createAttendanceDto: CreateAttendanceDto, user?: any) {
    const student = await this.validateAndGetStudent(createAttendanceDto.studentId);
    const classData = await this.validateAndGetClass(createAttendanceDto.classId);
    
    await this.validateStudentBelongsToClass(student, classData);
    await this.assertMayRecordForClass(
      user,
      createAttendanceDto.classId,
      createAttendanceDto.date,
    );
    await this.checkForDuplicateAttendance(
      createAttendanceDto.studentId,
      createAttendanceDto.classId,
      createAttendanceDto.date
    );

    const attendance = await this.attendanceModel.create({
      studentId: createAttendanceDto.studentId,
      classId: createAttendanceDto.classId,
      date: new Date(createAttendanceDto.date),
      name: student.name,
      recordedBy: user?.userId ?? null,
    });

    await this.announceAbsence(attendance, student, classData);

    await attendance.populate([
      { path: 'studentId', select: AttendanceService.DETAILED_STUDENT_FIELDS },
      { path: 'classId', select: AttendanceService.CLASS_FIELDS },
    ]);

    return transformAttendanceResponse(attendance);
  }

  /**
   * Filters and retrieves attendance records with optional pagination
   */
  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query = this.buildFilterQuery(filters);

    const total = await this.attendanceModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let attendanceQuery = this.attendanceModel
      .find(query)
      .populate('studentId', AttendanceService.STUDENT_FIELDS)
      .populate('classId', AttendanceService.CLASS_FIELDS_GENDER)
      .sort({ date: -1 });

    if (isPaginationRequested) {
      attendanceQuery = attendanceQuery
        .skip(paginationMeta.skip)
        .limit(paginationMeta.limit);
    }

    const attendances = await attendanceQuery.exec();

    if (isPaginationRequested) {
      return {
        data: attendances.map(attendance => transformAttendanceResponse(attendance)),
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages
      };
    }

    return attendances.map(attendance => transformAttendanceResponse(attendance));
  }

  /**
   * Updates an existing attendance record
   */
  async update(id: string, updateAttendanceDto: UpdateAttendanceDto, user?: any) {
    this.validateObjectId(id, 'Attendance ID');

    await this.assertMayTouchRecord(user, id);

    const attendance = await this.attendanceModel
      .findByIdAndUpdate(id, updateAttendanceDto, { new: true })
      .populate('studentId', AttendanceService.STUDENT_FIELDS)
      .populate('classId', AttendanceService.CLASS_FIELDS);

    if (!attendance) {
      throw new NotFoundException(`سجل الحضور ذو المعرف ${id} غير موجود`);
    }

    return transformAttendanceResponse(attendance);
  }

  async getMyAttendance(studentId: string) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    const records = await this.attendanceModel
      .find({ studentId })
      .populate('classId', AttendanceService.CLASS_FIELDS)
      .sort({ date: -1 })
      .exec();

    return {
      message: 'تم استرجاع سجلات غياب الطالب بنجاح',
      total: records.length,
      data: records.map(a => transformAttendanceResponse(a)),
    };
  }

  /**
   * Deletes an attendance record by ID
   */
  async delete(id: string, user?: any) {
    this.validateObjectId(id, 'Attendance ID');

    await this.assertMayTouchRecord(user, id);

    const attendance = await this.attendanceModel.findByIdAndDelete(id);

    if (!attendance) {
      throw new NotFoundException(`سجل الحضور ذو المعرف ${id} غير موجود`);
    }

    return { 
      message: 'تم حذف سجل الحضور بنجاح',
      data: attendance 
    };
  }

  // ==================== Private Helper Methods ====================

  /**
   * Validates ObjectId format
   */
  private validateObjectId(id: string, fieldName: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${fieldName} غير صحيحة: ${id}`);
    }
  }

  /**
   * Validates and retrieves student by ID
   */
  private async validateAndGetStudent(studentId: string): Promise<Student> {
    this.validateObjectId(studentId, 'Student ID');
    
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب ذو المعرف ${studentId} غير موجود`);
    }
    return student;
  }

  /**
   * Validates and retrieves class by ID
   */
  private async validateAndGetClass(classId: string): Promise<Class> {
    this.validateObjectId(classId, 'Class ID');
    
    const classData = await this.classModel.findById(classId);
    if (!classData) {
      throw new NotFoundException(`الفصل ذو المعرف ${classId} غير موجود`);
    }
    return classData;
  }

  /**
   * Validates that the student belongs to the specified class
   */
  private validateStudentBelongsToClass(student: Student, classData: Class) {
    if (!student) {
      throw new NotFoundException('الطالب غير موجود');
    }
  }

  /**
   * Checks for duplicate attendance records
   */
  private async checkForDuplicateAttendance(
    studentId: string,
    classId: string,
    date: string
  ) {
    const existingAttendance = await this.attendanceModel.findOne({
      studentId,
      classId,
      date: new Date(date),
    });

    if (existingAttendance) {
      throw new ConflictException(
        'سجل الحضور موجود بالفعل لهذا الطالب في هذا التاريخ'
      );
    }
  }

  /**
   * Builds filter query from filter parameters
   */
  private buildFilterQuery(filters: any): any {
    const query: any = {};
    const objectIdFields = ['studentId', 'classId', '_id'];
    const dateFields = ['date'];
    const textSearchFields = ['name'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;

      if (['page', 'limit', 'startDate', 'endDate'].includes(key)) continue;

      const stringValue = String(value);

      if (objectIdFields.includes(key)) {
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else if (dateFields.includes(key)) {
        query[key] = new Date(stringValue);
      } else if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else {
        query[key] = stringValue;
      }
    }

    // Handle date range filtering
    if (filters.startDate || filters.endDate) {
      query.date = {};
      if (filters.startDate) {
        query.date.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        query.date.$lte = new Date(filters.endDate);
      }
    }

    return query;
  }
}
