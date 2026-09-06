import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Preparation } from './schemas/preparation.schema';
import { PreparationResource } from './schemas/preparation-resource.schema';
import { CurriculumLesson } from '../curriculum/schemas/curriculum-lesson.schema';
import { CurriculumUnit } from '../curriculum/schemas/curriculum-unit.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { Library } from '../library/schemas/library.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { Project } from '../projects/schemas/project.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { CreatePreparationResourceDto } from './dto/create-preparation-resource.dto';
import {
  DEFAULT_TEACHING_AIDS,
  DEFAULT_TEACHING_STRATEGIES,
  REQUIRED_RESOURCE_MESSAGE,
  STUDENT_FIELDS,
} from './constants/preparation-constants';

@Injectable()
export class PreparationContentService {
  constructor(
    @InjectModel(Preparation.name)
    private readonly preparations: Model<Preparation>,
    @InjectModel(PreparationResource.name)
    private readonly resources: Model<PreparationResource>,
    @InjectModel(CurriculumLesson.name)
    private readonly lessons: Model<CurriculumLesson>,
    @InjectModel(CurriculumUnit.name)
    private readonly units: Model<CurriculumUnit>,
    @InjectModel(SubjectOffering.name)
    private readonly offerings: Model<SubjectOffering>,
    @InjectModel(Library.name) private readonly library: Model<Library>,
    @InjectModel(Exam.name) private readonly exams: Model<Exam>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(Enrollment.name)
    private readonly enrollments: Model<Enrollment>,
    @InjectModel(Student.name) private readonly students: Model<Student>,
  ) {}
  referenceLists() {
    return {
      teachingStrategies: DEFAULT_TEACHING_STRATEGIES,
      teachingAids: DEFAULT_TEACHING_AIDS,
    };
  }
  private id(value: any): string {
    return String(value?._id ?? value ?? '');
  }
  private async offering(value: any) {
    // Archived preparations contain a populated subject-offering snapshot.
    if (value?.subjectId && value?.gradeLevelId) return value;
    const offering = Types.ObjectId.isValid(this.id(value))
      ? await this.offerings.findById(this.id(value))
      : null;
    if (!offering) throw new BadRequestException('عرض المادة غير موجود');
    return offering;
  }
  async validateReferences(fields: any, subject: any) {
    let lesson: any = null;
    if (fields.lessonId) {
      lesson = await this.lessons.findById(this.id(fields.lessonId));
      if (!lesson)
        throw new BadRequestException('الدرس غير موجود في منهج المدرسة');
      const unit = await this.units.findById(lesson.unitId);
      const offering = await this.offering(subject);
      if (
        !unit ||
        this.id(unit.subjectId) !== this.id(offering.subjectId) ||
        this.id(unit.gradeLevelId) !== this.id(offering.gradeLevelId)
      ) {
        throw new BadRequestException('الدرس لا ينتمي إلى مادة وصف المحاضرة');
      }
    }
    if (fields.digitalContentIds?.length) {
      const ids = [...new Set(fields.digitalContentIds.map((v) => this.id(v)))];
      const items = await this.library.find({ _id: { $in: ids } });
      if (items.length !== ids.length)
        throw new BadRequestException(
          'المحتوى الرقمي غير موجود في مكتبة المدرسة',
        );
      const offering = await this.offering(subject);
      for (const item of items) {
        if (!item.subjectOfferingId) continue; // School-wide reusable library item.
        const itemOffering = await this.offering(item.subjectOfferingId);
        if (
          this.id(itemOffering.subjectId) !== this.id(offering.subjectId) ||
          this.id(itemOffering.gradeLevelId) !== this.id(offering.gradeLevelId)
        )
          throw new BadRequestException(
            'المحتوى الرقمي لا ينتمي إلى مادة وصف المحاضرة',
          );
      }
    }
    return lesson;
  }
  private async owned(id: string, user: any) {
    const prep = await this.preparations.findById(id);
    if (!prep) throw new NotFoundException('التحضير غير موجود');
    if (
      user?.role === 'STUDENT' ||
      (user?.role === 'TEACHER' &&
        this.id(prep.submittedBy) !== this.id(user.userId))
    )
      throw new ForbiddenException('ليس مسموحاً لك بتعديل هذا التحضير');
    return prep;
  }
  private revisionFilter(prep: any) {
    return {
      _id: prep._id,
      $or: [
        { contentRevision: prep.contentRevision ?? 0 },
        ...(prep.contentRevision
          ? []
          : [{ contentRevision: { $exists: false } }]),
      ],
    };
  }
  async submit(id: string, user: any) {
    const prep = await this.owned(id, user);
    if (!['draft', 'needs_revision'].includes(prep.reviewStatus))
      throw new BadRequestException(
        'يمكن إرسال المسودة أو التحضير المطلوب تعديله فقط',
      );
    const resources = await this.resources.find({ preparationId: id });
    if (!resources.length)
      throw new BadRequestException(REQUIRED_RESOURCE_MESSAGE);
    const objectives = (prep.objectives ?? [])
      .map((v) => v.trim())
      .filter(Boolean);
    if (!objectives.length)
      throw new BadRequestException('يجب إضافة هدف واحد على الأقل');
    if (!prep.digitalContentIds?.length)
      throw new BadRequestException('يجب إضافة محتوى رقمي واحد على الأقل');
    if (!prep.lessonId)
      throw new BadRequestException('يجب اختيار درس من المنهج');
    await this.validateReferences(prep, prep.subject);
    for (const resource of resources)
      await this.validateResource(resource, prep);
    const updated = await this.preparations.findOneAndUpdate(
      { ...this.revisionFilter(prep), reviewStatus: prep.reviewStatus },
      {
        $set: {
          objectives,
          reviewStatus: 'pending',
          reviewedBy: null,
          reviewedByName: '',
          reviewedAt: null,
          reviewNote: '',
        },
        $inc: { contentRevision: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!updated)
      throw new ConflictException('تم تعديل التحضير، أعد تحميله قبل الإرسال');
    // Conditional atomic backfill: a manager's existing objectives always win.
    await this.lessons.updateOne(
      {
        _id: prep.lessonId,
        $or: [{ objectives: { $size: 0 } }, { objectives: { $exists: false } }],
      },
      { $set: { objectives } },
    );
    return { message: 'تم إرسال التحضير للمراجعة', data: updated };
  }
  private async validateResource(dto: any, prep: any) {
    if (dto.examId && dto.projectId)
      throw new BadRequestException('اختر اختباراً أو مشروعاً واحداً');
    if (
      (dto.examId && dto.type !== 'quiz') ||
      (dto.projectId && dto.type !== 'activity')
    )
      throw new BadRequestException('نوع التكليف لا يطابق المرجع');
    if (!dto.examId && !dto.projectId && !dto.title?.trim())
      throw new BadRequestException('عنوان التكليف مطلوب');
    if (dto.startAt && dto.dueAt && new Date(dto.dueAt) < new Date(dto.startAt))
      throw new BadRequestException('نهاية التكليف تسبق بدايته');
    if (dto.examId || dto.projectId) {
      const record = dto.examId
        ? await this.exams.findById(dto.examId)
        : await this.projects.findById(dto.projectId);
      if (!record)
        throw new BadRequestException('التكليف المرتبط غير موجود في المدرسة');
      if (
        this.id(record.subjectOfferingId) !== this.id(prep.subject) ||
        !record.classIds.some((c) => this.id(c) === this.id(prep.classId))
      )
        throw new BadRequestException('التكليف لا ينتمي إلى مادة وفصل التحضير');
    }
  }
  private invalidate(id: string) {
    return this.preparations.findByIdAndUpdate(id, {
      $set: {
        reviewStatus: 'draft',
        reviewedBy: null,
        reviewedByName: '',
        reviewedAt: null,
        reviewNote: '',
      },
      $inc: { contentRevision: 1 },
    });
  }
  async createResource(
    id: string,
    dto: CreatePreparationResourceDto,
    user: any,
  ) {
    const prep = await this.owned(id, user);
    await this.validateResource(dto, prep);
    if (!(await this.invalidate(id)))
      throw new NotFoundException('التحضير غير موجود');
    const resource = await this.resources.create({ ...dto, preparationId: id });
    // Invalidating on both sides prevents a concurrent submit retaining a stale review.
    if (!(await this.invalidate(id))) {
      await this.resources.deleteOne({ _id: resource._id });
      throw new NotFoundException('التحضير غير موجود');
    }
    return resource;
  }
  async deleteResource(id: string, rid: string, user: any) {
    await this.owned(id, user);
    if (!(await this.resources.exists({ _id: rid, preparationId: id })))
      throw new NotFoundException('التكليف غير موجود');
    await this.invalidate(id);
    await this.resources.deleteOne({ _id: rid, preparationId: id });
    await this.invalidate(id);
    return { deleted: true };
  }
  deleteResources(id: string) {
    return this.resources.deleteMany({ preparationId: id });
  }
  async details(id: string) {
    const resources = await this.resources
      .find({ preparationId: id })
      .sort({ createdAt: 1 })
      .lean();
    return { resources, resourcesCount: resources.length };
  }
  async studentFilter(user: any) {
    const enrollments = await this.enrollments
      .find({ studentId: user.userId, status: 'active' })
      .select('classId')
      .lean();
    const classes = enrollments.map((e) => e.classId);
    // Legacy students without any enrollment rows still carry their class directly.
    if (
      !classes.length &&
      !(await this.enrollments.exists({ studentId: user.userId }))
    ) {
      const student = await this.students
        .findById(user.userId)
        .select('classId')
        .lean();
      if (student?.classId) classes.push(student.classId);
    }
    return {
      classId: { $in: classes },
      reviewStatus: { $in: ['pending', 'approved'] },
    };
  }
  studentProjection(prep: any) {
    const obj = typeof prep.toObject === 'function' ? prep.toObject() : prep;
    return Object.fromEntries(
      STUDENT_FIELDS.map((key) => [
        key,
        obj[key] ??
          (key.endsWith('Ids') || key === 'objectives'
            ? []
            : key === 'lessonId'
              ? null
              : ''),
      ]),
    );
  }
  async studentView(id: string, user: any) {
    if (!user) throw new ForbiddenException();
    const scope = user.role === 'STUDENT' ? await this.studentFilter(user) : {};
    const prep = await this.preparations.findOne({ _id: id, ...scope });
    if (!prep) throw new NotFoundException('التحضير غير موجود');
    if (
      user.role === 'TEACHER' &&
      this.id(prep.submittedBy) !== this.id(user.userId)
    )
      throw new ForbiddenException();
    // IDs only: never populate exam answers, lesson suggestions or library metadata here.
    return this.studentProjection(prep);
  }
}
