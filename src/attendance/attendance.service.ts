import {
  Injectable,
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
import { transformAttendanceResponse } from './transforms/response.transform';

@Injectable()
export class AttendanceService {
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
  ) {}

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
