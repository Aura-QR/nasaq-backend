import { ConflictException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { CreateManagerDto } from './dto/managers.dto';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { JobTitle } from 'src/permissions/job-titles/job-title.schema';

/** Roles that live on the Admin collection (not Teacher) */
const ADMIN_ROLES = ['OWNER', 'MANAGER', 'SUPERVISOR'] as const;
type AdminRole = (typeof ADMIN_ROLES)[number];


@Injectable()
export class ManagersService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<Admin>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(JobTitle.name) private readonly jobTitleModel?: Model<JobTitle>,
  ) {}

  async createManagerAdmin(schoolId: string, dto: CreateManagerDto) {
    const username = dto.username.trim();
    const email = dto.email.toLowerCase().trim();
    const role = dto.role || 'MANAGER';

    // Check uniqueness globally to avoid conflicts
    const existingAdmin = await this.adminModel
      .findOne({ $or: [{ email }, { username }] })
      .setOptions({ skipTenantScope: true });

    if (existingAdmin) {
      throw new ConflictException('اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل');
    }

    const hashedPassword = await PasswordUtil.hash(dto.password);

    const newManager = await this.adminModel.create({
      username,
      email,
      password: hashedPassword,
      role,
      // A supervisor really does carry ['*']; a manager carries nothing,
      // because its rights are read from the school's MANAGER row at login.
      // dto.permissions is deliberately not stored — writing it would leave a
      // list on the document that nothing reads.
      permissions: role === 'SUPERVISOR' ? ['*'] : [],
      schoolId: new Types.ObjectId(schoolId),
    });

    return {
      id: newManager._id,
      username: newManager.username,
      email: newManager.email,
      role,
      permissions: newManager.permissions,
    };
  }

  /**
   * A promoted teacher gets the school's MANAGER rights merged on top of their
   * own at login, so there is nothing to pass here any more. The parameter is
   * kept so the existing route signature still binds; it is not stored.
   */
  async promoteTeacher(teacherId: string, _permissions?: string[]) {
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException('المعلم المطلوب غير موجود');
    }

    teacher.isManager = true;
    teacher.managerPermissions = [];
    await teacher.save();

    return {
      id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      isManager: true,
      permissions: teacher.managerPermissions,
    };
  }

  async demoteTeacher(teacherId: string) {
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException('المعلم المطلوب غير موجود');
    }

    teacher.isManager = false;
    teacher.managerPermissions = [];
    teacher.jobTitleId = null;
    await teacher.save();

    return {
      id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      isManager: false,
      permissions: [],
    };
  }

  async updatePermissions(id: string, type: 'admin' | 'teacher', permissions: string[], requesterRole?: string) {
    if (type === 'admin') {
      const admin = await this.adminModel.findById(id);
      if (!admin) {
        throw new NotFoundException('المدير المطلوب غير موجود');
      }
      if (requesterRole === 'SUPERVISOR' && (admin.role === 'SUPERVISOR' || admin.role === 'OWNER')) {
        throw new ForbiddenException('لا يمكن للمشرف تعديل صلاحيات مشرف آخر أو مالك المدرسة');
      }
      admin.permissions = permissions;
      await admin.save();
      return {
        id: admin._id,
        role: admin.role,
        permissions: admin.permissions,
      };
    } else {
      const teacher = await this.teacherModel.findOne({ _id: id, isManager: true });
      if (!teacher) {
        throw new NotFoundException('المعلم المطلوب غير موجود أو ليس مديراً');
      }
      teacher.managerPermissions = permissions;
      await teacher.save();
      return {
        id: teacher._id,
        role: 'TEACHER',
        permissions: teacher.managerPermissions,
      };
    }
  }

  async findAllManagers() {
    const admins = await this.adminModel
      .find({ role: { $in: ['MANAGER', 'SUPERVISOR'] } })
      .lean();
    const teachers = await this.teacherModel.find({ isManager: true }).lean();

    // The title each assistant logs in with, so the table can show «المالية»
    // instead of «مساعد إداري» for everyone.
    const titleIds = [...admins, ...teachers].map((account: any) => account.jobTitleId).filter(Boolean);
    const titles = this.jobTitleModel && titleIds.length
      ? await this.jobTitleModel.find({ _id: { $in: titleIds } }).select('name').lean()
      : [];
    const titleNames = new Map(titles.map((title: any) => [String(title._id), title.name]));
    const jobTitleOf = (account: any) => {
      const id = account.jobTitleId ? String(account.jobTitleId) : null;
      return id && titleNames.has(id) ? { id, name: titleNames.get(id) } : null;
    };

    const formattedAdmins = admins.map((a: any) => ({
      id: a._id,
      name: a.username,
      email: a.email,
      type: 'admin',
      role: a.role,
      permissions: a.permissions || [],
      isActive: true,
      jobTitle: a.role === 'MANAGER' ? jobTitleOf(a) : null,
    }));

    const formattedTeachers = teachers.map((t: any) => ({
      id: t._id,
      name: t.name,
      email: t.email,
      type: 'teacher',
      role: 'TEACHER',
      permissions: t.managerPermissions || [],
      isActive: t.isActive,
      jobTitle: jobTitleOf(t),
    }));

    return [...formattedAdmins, ...formattedTeachers];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SET / RESET PASSWORD FOR AN ADMIN (OWNER / MANAGER / SUPERVISOR)
  //
  // requesterRole rules:
  //   SUPER_ADMIN → can reset anyone
  //   OWNER       → can reset MANAGER and SUPERVISOR
  //   SUPERVISOR  → can reset MANAGER only
  //   (MANAGER has no access to this endpoint — guarded at controller level)
  // ─────────────────────────────────────────────────────────────────────────
  async setAdminPassword(
    id: string,
    requesterRole: string,
    password?: string,
  ): Promise<{ message: string; data: Record<string, unknown> }> {
    const admin = await this.adminModel
      .findById(id)
      .select('username email role')
      .setOptions({ skipTenantScope: true })
      .exec();

    if (!admin) {
      throw new NotFoundException(`المسؤول بمعرف ${id} غير موجود`);
    }

    const targetRole = admin.role as AdminRole;

    // Role-hierarchy enforcement
    if (requesterRole === 'SUPERVISOR') {
      if (targetRole === 'SUPERVISOR' || targetRole === 'OWNER') {
        throw new ForbiddenException(
          'لا يمكن للمشرف تغيير كلمة مرور مشرف آخر أو مالك المدرسة',
        );
      }
    } else if (requesterRole === 'OWNER') {
      // OWNER can reset MANAGER and SUPERVISOR but not another OWNER
      if (targetRole === 'OWNER') {
        throw new ForbiddenException(
          'لا يمكن لمالك المدرسة تغيير كلمة مرور مالك آخر',
        );
      }
    }
    // SUPER_ADMIN has no restrictions

    const plaintext = password ?? PasswordUtil.generate();
    const hashedPassword = await PasswordUtil.hash(plaintext);

    await this.adminModel
      .findByIdAndUpdate(
        id,
        {
          $set: { password: hashedPassword },
          $unset: { otp: '', otpExpiry: '' },
        },
        { skipTenantScope: true },
      )
      .exec();

    return {
      message: 'تم تعيين كلمة المرور',
      data: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        ...(password == null ? { password: plaintext } : {}),
      },
    };
  }

  async removeManager(id: string, type: 'admin' | 'teacher', requesterRole?: string) {
    if (type === 'admin') {
      const admin = await this.adminModel.findById(id);
      if (!admin) {
        throw new NotFoundException('المدير المطلوب غير موجود');
      }
      if (requesterRole === 'SUPERVISOR' && (admin.role === 'SUPERVISOR' || admin.role === 'OWNER')) {
        throw new ForbiddenException('لا يمكن للمشرف حذف مشرف آخر أو مالك المدرسة');
      }
      await this.adminModel.deleteOne({ _id: id });
    } else {
      const teacher = await this.teacherModel.findOne({ _id: id, isManager: true });
      if (!teacher) {
        throw new NotFoundException('المعلم المطلوب غير موجود أو ليس مديراً');
      }
      teacher.isManager = false;
      teacher.managerPermissions = [];
      teacher.jobTitleId = null;
      await teacher.save();
    }
    return { success: true };
  }
}
