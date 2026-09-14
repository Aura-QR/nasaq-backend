import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { JobTitle } from './job-title.schema';
import { AssignJobTitleDto, CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto';
import { jobTitleTemplates, normalizeTitlePermissions } from './job-title-permissions';

const oid = (value: string, message: string) => {
  if (!Types.ObjectId.isValid(String(value))) throw new NotFoundException(message);
  return new Types.ObjectId(String(value));
};

@Injectable()
export class JobTitlesService {
  constructor(
    @InjectModel(JobTitle.name) private readonly titles: Model<JobTitle>,
    @InjectModel(Admin.name) private readonly admins: Model<Admin>,
    @InjectModel(Teacher.name) private readonly teachers: Model<Teacher>,
  ) {}

  templates() {
    return jobTitleTemplates();
  }

  /** The school's titles, each with how many accounts carry it. */
  async list(schoolId: string) {
    const school = new Types.ObjectId(schoolId);
    const [titles, adminCounts, teacherCounts] = await Promise.all([
      this.titles.find({ schoolId: school }).sort({ name: 1, _id: 1 }).lean(),
      this.admins.aggregate([
        { $match: { schoolId: school, role: 'MANAGER', jobTitleId: { $ne: null } } },
        { $group: { _id: '$jobTitleId', count: { $sum: 1 } } },
      ]),
      this.teachers.aggregate([
        { $match: { schoolId: school, isManager: true, jobTitleId: { $ne: null } } },
        { $group: { _id: '$jobTitleId', count: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map<string, number>();
    for (const row of [...adminCounts, ...teacherCounts]) {
      counts.set(String(row._id), (counts.get(String(row._id)) ?? 0) + row.count);
    }
    return titles.map((title) => ({
      id: String(title._id),
      name: title.name,
      templateKey: title.templateKey,
      permissions: normalizeTitlePermissions(title.permissions),
      assignedCount: counts.get(String(title._id)) ?? 0,
      updatedAt: (title as any).updatedAt,
    }));
  }

  async create(schoolId: string, dto: CreateJobTitleDto, userId?: string) {
    const template = dto.templateKey ? jobTitleTemplates().find((t) => t.key === dto.templateKey) : undefined;
    const permissions =
      dto.permissions !== undefined
        ? normalizeTitlePermissions(dto.permissions, { strict: true })
        : normalizeTitlePermissions(template?.permissions);

    await this.assertNameFree(schoolId, dto.name);
    const title = await this.titles.create({
      schoolId: new Types.ObjectId(schoolId),
      name: dto.name,
      templateKey: template?.key ?? null,
      permissions,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
    });
    return this.one(schoolId, String(title._id));
  }

  async update(schoolId: string, id: string, dto: UpdateJobTitleDto, userId?: string) {
    const title = await this.find(schoolId, id);
    const set: Record<string, unknown> = {
      updatedBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
    };
    if (dto.name !== undefined && dto.name !== title.name) {
      await this.assertNameFree(schoolId, dto.name, id);
      set.name = dto.name;
    }
    if (dto.permissions !== undefined) {
      set.permissions = normalizeTitlePermissions(dto.permissions, { strict: true });
    }
    await this.titles.updateOne({ _id: title._id, schoolId: new Types.ObjectId(schoolId) }, { $set: set });
    return this.one(schoolId, id);
  }

  /** Refused while any account carries the title: those logins would silently change. */
  async remove(schoolId: string, id: string) {
    const title = await this.find(schoolId, id);
    const school = new Types.ObjectId(schoolId);
    const [admins, teachers] = await Promise.all([
      this.admins.countDocuments({ schoolId: school, jobTitleId: title._id }),
      this.teachers.countDocuments({ schoolId: school, jobTitleId: title._id }),
    ]);
    const assigned = admins + teachers;
    if (assigned > 0) {
      throw new ConflictException(
        `لا يمكن حذف «${title.name}» لأنه مُسند إلى ${assigned} من المساعدين. غيّر مسمّاهم أولًا ثم احذفه.`,
      );
    }
    await this.titles.deleteOne({ _id: title._id, schoolId: school });
    return { message: 'تم حذف المسمى الوظيفي' };
  }

  /**
   * Give an assistant a title, or clear it with null.
   *
   * Only MANAGER accounts and teachers promoted to manager can carry one. The
   * owner and supervisors log in with every permission; a title on them would be
   * stored and never read.
   */
  async assign(schoolId: string, accountId: string, dto: AssignJobTitleDto) {
    const school = new Types.ObjectId(schoolId);
    const title = dto.jobTitleId === null ? null : await this.find(schoolId, dto.jobTitleId);
    const _id = oid(accountId, 'الحساب غير موجود');
    const jobTitleId = title ? title._id : null;

    if (dto.type === 'admin') {
      const admin = await this.admins.findOne({ _id, schoolId: school }).select('role username').lean();
      if (!admin) throw new NotFoundException('الحساب غير موجود');
      if (admin.role !== 'MANAGER') {
        throw new ConflictException('المسمى الوظيفي للمساعدين الإداريين فقط؛ المالك والمدير يملكان كل الصلاحيات');
      }
      await this.admins.updateOne({ _id, schoolId: school }, { $set: { jobTitleId } });
    } else {
      const teacher = await this.teachers.findOne({ _id, schoolId: school }).select('isManager name').lean();
      if (!teacher) throw new NotFoundException('الحساب غير موجود');
      if (!teacher.isManager) {
        throw new ConflictException('هذا المعلم ليس مساعدًا إداريًا؛ رقِّه أولًا ثم أسند له مسمى');
      }
      await this.teachers.updateOne({ _id, schoolId: school }, { $set: { jobTitleId } });
    }

    return {
      message: title
        ? `تم إسناد «${title.name}». يسري عند تسجيل الدخول القادم لهذا المستخدم.`
        : 'تمت إزالة المسمى الوظيفي. يعود للصلاحيات الافتراضية للمساعدين عند تسجيل الدخول القادم.',
      accountId,
      type: dto.type,
      jobTitle: title ? { id: String(title._id), name: title.name } : null,
    };
  }

  private async one(schoolId: string, id: string) {
    const all = await this.list(schoolId);
    return all.find((title) => title.id === id);
  }

  private async find(schoolId: string, id: string) {
    const title = await this.titles
      .findOne({ _id: oid(id, 'المسمى الوظيفي غير موجود'), schoolId: new Types.ObjectId(schoolId) })
      .lean();
    if (!title) throw new NotFoundException('المسمى الوظيفي غير موجود');
    return title;
  }

  private async assertNameFree(schoolId: string, name: string, exceptId?: string) {
    const clash = await this.titles
      .findOne({
        schoolId: new Types.ObjectId(schoolId),
        name,
        ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
      })
      .select('_id')
      .lean();
    if (clash) throw new ConflictException(`يوجد مسمى وظيفي باسم «${name}» بالفعل`);
  }
}
