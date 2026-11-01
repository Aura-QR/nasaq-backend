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
import { CredentialsDeliveryService } from 'src/messaging/credentials-delivery.service';

@Injectable()
export class TeachersService {
  constructor(
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<Subject>,
    @InjectModel(TeacherAssignment.name)
    private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    private readonly credentialsDelivery: CredentialsDeliveryService,
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

    const { status, subjects, subjectIds, subjectOfferingIds, password, ...teacherFields } =
      createTeacherDto as any;

    /*
     * A teacher created without a password used to get the literal
     * 'Teacher@123' — the same password for every teacher in every school,
     * which anyone who has ever seen one teacher's welcome message can then
     * use on the rest. Now an unspecified password is generated per teacher,
     * and the WhatsApp message below is what tells them what it is.
     */
    const issuedPassword: string = password || PasswordUtil.generate();
    const hashedPassword = await PasswordUtil.hash(issuedPassword);

    const teacher = new this.teacherModel({
      ...teacherFields,
      password: hashedPassword,
    });
    await teacher.save();

    if (Array.isArray(subjectOfferingIds) && subjectOfferingIds.length > 0) {
      await this.syncAssignments(teacher._id.toString(), subjectOfferingIds);
    }

    await this.credentialsDelivery.enqueue({
      schoolId: (teacher as any).schoolId,
      recipientRole: 'TEACHER',
      recipientId: teacher._id as any,
      recipientName: teacher.name,
      phone: (teacher as any).phoneNumber,
      loginEmail: teacher.email,
      password: issuedPassword,
      reason: 'created',
    });

    const teacherWithSubjects = await this.withSubjects(teacher);
    const { password: _hash, otp: _otp, ...safeTeacher } = teacherWithSubjects;

    return {
      message: 'تم إضافة المعلم بنجاح',
      teacher: safeTeacher,
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
          { path: 'subjectId', select: 'subjectName subjectCode isActivity' },
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

  async setAdminPassword(id: string, password?: string) {
    const teacher = await this.teacherModel
      .findById(id)
      .select('name email phoneNumber schoolId')
      .exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    const plaintext = password ?? PasswordUtil.generate();
    const hashedPassword = await PasswordUtil.hash(plaintext);
    const updatedTeacher = await this.teacherModel
      .findByIdAndUpdate(
        id,
        {
          $set: { password: hashedPassword },
          $unset: { otp: '', otpExpiry: '' },
        },
        { new: true },
      )
      .select('name')
      .exec();
    if (!updatedTeacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    await this.credentialsDelivery.enqueue({
      schoolId: (teacher as any).schoolId,
      recipientRole: 'TEACHER',
      recipientId: id,
      recipientName: teacher.name,
      phone: (teacher as any).phoneNumber,
      loginEmail: (teacher as any).email,
      password: plaintext,
      reason: 'password_reset',
    });

    return {
      message: 'تم تعيين كلمة المرور',
      data: {
        id: updatedTeacher._id,
        name: updatedTeacher.name,
        ...(password == null ? { password: plaintext } : {}),
      },
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

  /**
   * What «إنهاء خدمة المعلم» would do, without doing it.
   *
   * A teacher who leaves cannot be deleted while lectures point at her, and
   * moving them one by one through the timetable is 20-odd edits. This shows
   * where each lecture goes: to the replacement, or — when the replacement
   * already teaches another class in that period — left without a teacher.
   */
  async previewEndService(id: string, replacementTeacherId?: string) {
    const plan = await this.planEndService(id, replacementTeacherId);
    return {
      message: 'تم تجهيز ملخص إنهاء الخدمة',
      data: this.describePlan(plan),
    };
  }

  /**
   * Ends a teacher's service: her lectures and subject assignments go to the
   * replacement and her account is deactivated, which also stops her signing
   * in. Nothing she recorded is deleted.
   */
  async endService(id: string, replacementTeacherId?: string) {
    const plan = await this.planEndService(id, replacementTeacherId);
    const { teacher, replacement, lectures, conflictIds, assignments } = plan;

    if (teacher.isActive === false && (teacher as any).serviceEndedAt) {
      throw new BadRequestException('تم إنهاء خدمة هذا المعلم بالفعل');
    }

    const unassignIds = replacement
      ? lectures.filter((l) => conflictIds.has(String(l._id))).map((l) => l._id)
      : lectures.map((l) => l._id);
    const moveIds = replacement
      ? lectures.filter((l) => !conflictIds.has(String(l._id))).map((l) => l._id)
      : [];

    if (unassignIds.length) {
      await this.lectureModel
        .updateMany({ _id: { $in: unassignIds } }, { $set: { teacherId: null } })
        .exec();
    }

    if (moveIds.length) {
      try {
        await this.lectureModel
          .updateMany({ _id: { $in: moveIds } }, { $set: { teacherId: replacement._id } })
          .exec();
      } catch (error: any) {
        // The replacement was booked into one of these periods between the
        // check above and this write.
        if (error?.code === 11000) {
          throw new ConflictException(
            'تغيّر جدول المعلم البديل أثناء التنفيذ، يرجى إعادة المحاولة',
          );
        }
        throw error;
      }
    }

    if (replacement && assignments.length) {
      const existing = await this.teacherAssignmentModel
        .find({ teacherId: replacement._id })
        .select('subjectOfferingId classId')
        .lean()
        .exec();
      const key = (a: any) => `${String(a.subjectOfferingId)}|${String(a.classId ?? null)}`;
      const held = new Set((existing as any[]).map(key));
      const toCreate = assignments
        .filter((a: any) => !held.has(key(a)))
        .map((a: any) => ({
          teacherId: replacement._id,
          subjectOfferingId: a.subjectOfferingId,
          classId: a.classId ?? null,
        }));
      if (toCreate.length) {
        await this.teacherAssignmentModel.create(toCreate);
      }
    }
    // Her assignments go either way: left behind, an inactive teacher keeps
    // being offered for these subjects in every timetable form.
    if (assignments.length) {
      await this.teacherAssignmentModel.deleteMany({ teacherId: teacher._id }).exec();
    }

    await this.teacherModel
      .updateOne(
        { _id: teacher._id },
        {
          $set: {
            isActive: false,
            serviceEndedAt: new Date(),
            replacedByTeacherId: replacement?._id ?? null,
          },
        },
      )
      .exec();

    return {
      message: replacement
        ? `تم إنهاء خدمة ${teacher.name} ونقل ${moveIds.length} حصة إلى ${replacement.name}`
        : `تم إنهاء خدمة ${teacher.name}`,
      data: {
        ...this.describePlan(plan),
        movedLectures: moveIds.length,
        unassignedLectures: unassignIds.length,
      },
    };
  }

  private async planEndService(id: string, replacementTeacherId?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('معرّف المعلم غير صالح');
    }
    const teacher = await this.teacherModel.findById(id).exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    let replacement: any = null;
    if (replacementTeacherId) {
      if (!Types.ObjectId.isValid(replacementTeacherId)) {
        throw new BadRequestException('المعلم البديل غير صالح');
      }
      if (String(replacementTeacherId) === String(teacher._id)) {
        throw new BadRequestException('لا يمكن اختيار المعلم نفسه بديلاً');
      }
      replacement = await this.teacherModel.findById(replacementTeacherId).exec();
      if (!replacement) {
        throw new NotFoundException('المعلم البديل غير موجود');
      }
      if (replacement.isActive === false) {
        throw new BadRequestException('المعلم البديل غير مفعّل');
      }
    }

    const populateLecture = [
      { path: 'classId', select: 'name' },
      {
        path: 'subjectOfferingId',
        select: 'subjectId',
        populate: { path: 'subjectId', select: 'subjectName' },
      },
    ];

    const lectures = (await this.lectureModel
      .find({ teacherId: teacher._id })
      .populate(populateLecture)
      .lean()
      .exec()) as any[];

    const slotKey = (l: any) =>
      `${l.dayOfWeek}|${l.slot}|${String(l.termId?._id ?? l.termId)}`;

    const busy = new Map<string, any>();
    if (replacement && lectures.length) {
      const replacementLectures = (await this.lectureModel
        .find({ teacherId: replacement._id })
        .populate(populateLecture)
        .lean()
        .exec()) as any[];
      for (const l of replacementLectures) busy.set(slotKey(l), l);
    }

    const conflicts = lectures
      .filter((l) => busy.has(slotKey(l)))
      .map((l) => ({ lecture: l, busyWith: busy.get(slotKey(l)) }));
    const conflictIds = new Set(conflicts.map((c) => String(c.lecture._id)));

    const assignments = await this.teacherAssignmentModel
      .find({ teacherId: teacher._id })
      .lean()
      .exec();

    return { teacher, replacement, lectures, conflicts, conflictIds, assignments };
  }

  private describePlan(plan: Awaited<ReturnType<TeachersService['planEndService']>>) {
    const { teacher, replacement, lectures, conflicts, assignments } = plan;
    const describeLecture = (l: any) => ({
      id: String(l._id),
      dayOfWeek: l.dayOfWeek,
      slot: l.slot,
      className: l.classId?.name ?? null,
      subjectName: l.subjectOfferingId?.subjectId?.subjectName ?? null,
    });

    return {
      teacher: { id: String(teacher._id), name: teacher.name, isActive: teacher.isActive },
      replacement: replacement ? { id: String(replacement._id), name: replacement.name } : null,
      lectureCount: lectures.length,
      toMove: replacement ? lectures.length - conflicts.length : 0,
      toUnassign: replacement ? conflicts.length : lectures.length,
      assignmentCount: assignments.length,
      conflicts: conflicts.map((c) => ({
        ...describeLecture(c.lecture),
        busyWith: describeLecture(c.busyWith),
      })),
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
