import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { Teacher } from './schemas/teacher.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { TeacherAssignment } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { PasswordUtil } from 'src/auth/utils/password.util';

@Injectable()
export class TeachersService {
  constructor(
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<Subject>,
    @InjectModel(TeacherAssignment.name)
    private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
  ) {}

  async create(createTeacherDto: CreateTeacherDto) {
    const existingEmailTeacher = await this.teacherModel.findOne({
      email: createTeacherDto.email,
    });

    if (existingEmailTeacher) {
      throw new ConflictException('Email already exists');
    }

    if (createTeacherDto.status !== undefined && createTeacherDto.isActive === undefined) {
      createTeacherDto.isActive = createTeacherDto.status === 'active' || createTeacherDto.status === 'true';
    }
    if (createTeacherDto.isActive === undefined) {
      createTeacherDto.isActive = true;
    }
    if (!createTeacherDto.hireDate) {
      createTeacherDto.hireDate = new Date().toISOString().split('T')[0];
    }

    const { status, subjects, password, ...teacherFields } = createTeacherDto as any;
    const hashedPassword = await PasswordUtil.hash(password || 'Teacher@123');

    const teacher = new this.teacherModel({
      ...teacherFields,
      password: hashedPassword,
    });
    await teacher.save();

    // `select: false` hides the hash from QUERIES, but this document was just
    // built in memory, so it still carries it. Strip it explicitly or the
    // create response leaks what every read is careful not to.
    const { password: _hash, otp: _otp, ...safeTeacher } = teacher.toObject() as any;

    return {
      message: 'تم إضافة المعلم بنجاح',
      // Always empty at this point — assignments are created separately through
      // POST /teacher-assignments — but present so the client can rely on the
      // same shape it gets from every other teacher route.
      teacher: { ...safeTeacher, subjects: [], subjectIds: [], subjectOfferings: [] },
    };
  }

  /**
   * The subjects a teacher teaches, read from the assignment table.
   *
   * A Teacher document has no subject field and never had one — the relation
   * lives in `teacherAssignments` (teacher -> subjectOffering -> subject).
   * Every teacher read therefore came back with nothing to show, and the
   * `subjectIds` the DTO still accepts on create/update was dropped by
   * mongoose on save. Reading it back has to be a join.
   *
   * Returns a map keyed by teacher id so a list costs one extra query, not one
   * per row.
   */
  private async loadSubjectsByTeacher(
    teacherIds: any[],
  ): Promise<Map<string, { subjects: any[]; subjectIds: string[]; subjectOfferings: any[] }>> {
    const result = new Map<string, { subjects: any[]; subjectIds: string[]; subjectOfferings: any[] }>();
    if (!teacherIds.length) return result;

    const assignments = await this.teacherAssignmentModel
      .find({ teacherId: { $in: teacherIds.map((id) => new Types.ObjectId(String(id))) } })
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
          { path: 'termId', select: 'name order status' },
        ],
      })
      .lean()
      .exec();

    for (const assignment of assignments as any[]) {
      const teacherKey = String(assignment.teacherId);
      const offering = assignment.subjectOfferingId;
      if (!offering) continue; // offering deleted out from under the assignment

      const entry =
        result.get(teacherKey) ?? { subjects: [], subjectIds: [], subjectOfferings: [] };

      const subject = offering.subjectId;
      if (subject?._id) {
        const subjectKey = String(subject._id);
        // One subject taught to three grades is still one subject in the
        // directory column, so dedupe here and keep the detail in
        // subjectOfferings.
        if (!entry.subjectIds.includes(subjectKey)) {
          entry.subjectIds.push(subjectKey);
          entry.subjects.push({
            _id: subject._id,
            subjectName: subject.subjectName,
            subjectCode: subject.subjectCode,
          });
        }
      }

      entry.subjectOfferings.push({
        assignmentId: assignment._id,
        subjectOfferingId: offering._id,
        subjectName: subject?.subjectName ?? null,
        subjectCode: subject?.subjectCode ?? null,
        gradeLevel: offering.gradeLevelId?.name ?? null,
        term: offering.termId?.name ?? null,
      });

      result.set(teacherKey, entry);
    }

    return result;
  }

  /** Attach the joined subjects to one teacher document (lean or hydrated). */
  private async withSubjects(teacher: any) {
    if (!teacher) return teacher;
    const plain = typeof teacher.toObject === 'function' ? teacher.toObject() : { ...teacher };
    const map = await this.loadSubjectsByTeacher([plain._id]);
    const entry = map.get(String(plain._id));
    return {
      ...plain,
      subjects: entry?.subjects ?? [],
      subjectIds: entry?.subjectIds ?? [],
      subjectOfferings: entry?.subjectOfferings ?? [],
    };
  }

  /**
   * Make the teacher's assignments match the given offerings exactly.
   *
   * Additive rather than delete-then-insert: an assignment that is staying put
   * keeps its _id, so nothing referencing it breaks, and a failure part-way
   * cannot leave the teacher with no subjects at all.
   */
  private async syncAssignments(teacherId: string, offeringIds: string[]) {
    const teacherObjectId = new Types.ObjectId(teacherId);
    const wanted = new Set(offeringIds.map(String));

    const current = await this.teacherAssignmentModel
      .find({ teacherId: teacherObjectId })
      .select('subjectOfferingId')
      .lean()
      .exec();

    const currentIds = new Set(
      (current as any[]).map((a) => String(a.subjectOfferingId)),
    );

    const toAdd = [...wanted].filter((offeringId) => !currentIds.has(offeringId));
    const toRemove = [...currentIds].filter((offeringId) => !wanted.has(offeringId));

    if (toAdd.length) {
      await this.teacherAssignmentModel.insertMany(
        toAdd.map((offeringId) => ({
          teacherId: teacherObjectId,
          subjectOfferingId: new Types.ObjectId(offeringId),
        })),
      );
    }

    if (toRemove.length) {
      await this.teacherAssignmentModel.deleteMany({
        teacherId: teacherObjectId,
        subjectOfferingId: { $in: toRemove.map((o) => new Types.ObjectId(o)) },
      });
    }
  }

  /** Same, for a list — one join query for the whole page. */
  private async withSubjectsMany(teachers: any[]) {
    if (!teachers.length) return [];
    const plain = teachers.map((t) =>
      typeof t.toObject === 'function' ? t.toObject() : { ...t },
    );
    const map = await this.loadSubjectsByTeacher(plain.map((t) => t._id));
    return plain.map((t) => {
      const entry = map.get(String(t._id));
      return {
        ...t,
        subjects: entry?.subjects ?? [],
        subjectIds: entry?.subjectIds ?? [],
        subjectOfferings: entry?.subjectOfferings ?? [],
      };
    });
  }

  async findAll() {
    return this.withSubjectsMany(await this.teacherModel.find().exec());
  }

  async findOne(id: string) {
    const teacher = await this.teacherModel.findById(id).exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }
    return this.withSubjects(teacher);
  }

  async update(id: string, updateTeacherDto: UpdateTeacherDto) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    if (updateTeacherDto.status !== undefined && updateTeacherDto.isActive === undefined) {
      updateTeacherDto.isActive = updateTeacherDto.status === 'active' || updateTeacherDto.status === 'true';
    }

    // subjects / subjectIds are read-only projections; subjectOfferingIds is
    // handled below against the assignment table. None of them is a path on
    // the Teacher schema, so leaving them in would let mongoose drop them
    // silently and the caller would never learn the write did nothing.
    const { status, subjects, subjectIds, subjectOfferingIds, ...cleanUpdateData } =
      updateTeacherDto as any;

    if (cleanUpdateData.email) {
      const existingTeacher = await this.teacherModel.findOne({
        email: cleanUpdateData.email,
        _id: { $ne: id },
      });

      if (existingTeacher) {
        throw new ConflictException('Email already exists');
      }
    }

    if (cleanUpdateData.password) {
      cleanUpdateData.password = await PasswordUtil.hash(cleanUpdateData.password);
    }

    const updatedTeacher = await this.teacherModel
      .findByIdAndUpdate(id, cleanUpdateData, { new: true })
      .exec();

    if (Array.isArray(subjectOfferingIds)) {
      await this.syncAssignments(id, subjectOfferingIds);
    }

    return {
      message: 'تم تحديث بيانات المعلم بنجاح',
      teacher: await this.withSubjects(updatedTeacher),
    };
  }

  async remove(id: string) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    const assignedLectures = await this.lectureModel.find({ teacherId: id }).exec();
    if (assignedLectures.length > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المعلم. المعلم مسند له ${assignedLectures.length} محاضرة. يرجى إزالة جميع المحاضرات المسندة أولاً`,
      );
    }
    await this.teacherModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المعلم بنجاح',
    };
  }

  async list() {
    const teachers = await this.teacherModel.find().sort({ createdAt: -1 }).exec();
    return teachers.map((teacher) => ({
      id: teacher._id,
      fullName: teacher.name,
    }));
  }

  async findActive() {
    return this.teacherModel.find({ isActive: true }).exec();
  }

  async findInactive() {
    return this.teacherModel.find({ isActive: false }).exec();
  }

  async toggleActive(id: string) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    teacher.isActive = !teacher.isActive;
    await teacher.save();

    return {
      message: `تم ${teacher.isActive ? 'تفعيل' : 'إلغاء تفعيل'} المعلم بنجاح`,
      teacher,
    };
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};
    const textSearchFields = ['name', 'qualification', 'experience', 'specialization', 'address'];
    const exactMatchFields = ['email', 'phoneNumber'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'isActive' || key === 'isInCharge') {
        query[key] = stringValue === 'true';
      } else if (key === 'hireDate') {
        query[key] = new Date(stringValue);
      } else if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (exactMatchFields.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }

    const total = await this.teacherModel.countDocuments(query).exec();
    const paginationMate = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let teachersQuery = this.teacherModel.find(query).sort({ createdAt: -1 });

    if (isPaginationRequested) {
      teachersQuery = teachersQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const teachers = await this.withSubjectsMany(await teachersQuery.exec());

    if (isPaginationRequested) {
      return {
        data: teachers,
        totalDocs: paginationMate.total,
        totalPages: paginationMate.totalPages,
      };
    }

    return teachers;
  }

  async getMyProfile(teacherId: string) {
    const teacher = await this.teacherModel.findById(teacherId).exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    const teacherObject = await this.withSubjects(teacher);
    const { password, ...rest } = teacherObject;

    return {
      message: 'تم استرجاع ملف المعلم بنجاح',
      data: rest,
    };
  }
}