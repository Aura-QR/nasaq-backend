import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { CreateManagerDto } from './dto/managers.dto';
import { PasswordUtil } from 'src/auth/utils/password.util';

@Injectable()
export class ManagersService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<Admin>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
  ) {}

  async createManagerAdmin(schoolId: string, dto: CreateManagerDto) {
    const username = dto.username.trim();
    const email = dto.email.toLowerCase().trim();

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
      role: 'MANAGER',
      permissions: dto.permissions,
      schoolId: new Types.ObjectId(schoolId),
    });

    return {
      id: newManager._id,
      username: newManager.username,
      email: newManager.email,
      role: 'MANAGER',
      permissions: newManager.permissions,
    };
  }

  async promoteTeacher(teacherId: string, permissions: string[]) {
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException('المعلم المطلوب غير موجود');
    }

    teacher.isManager = true;
    teacher.managerPermissions = permissions;
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
    await teacher.save();

    return {
      id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      isManager: false,
      permissions: [],
    };
  }

  async updatePermissions(id: string, type: 'admin' | 'teacher', permissions: string[]) {
    if (type === 'admin') {
      const admin = await this.adminModel.findOne({ _id: id, role: 'MANAGER' });
      if (!admin) {
        throw new NotFoundException('المدير المطلوب غير موجود');
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
    const admins = await this.adminModel.find({ role: 'MANAGER' }).lean();
    const teachers = await this.teacherModel.find({ isManager: true }).lean();

    const formattedAdmins = admins.map((a: any) => ({
      id: a._id,
      name: a.username,
      email: a.email,
      type: 'admin',
      role: 'MANAGER',
      permissions: a.permissions || [],
      isActive: true,
    }));

    const formattedTeachers = teachers.map((t: any) => ({
      id: t._id,
      name: t.name,
      email: t.email,
      type: 'teacher',
      role: 'TEACHER',
      permissions: t.managerPermissions || [],
      isActive: t.isActive,
    }));

    return [...formattedAdmins, ...formattedTeachers];
  }

  async removeManager(id: string, type: 'admin' | 'teacher') {
    if (type === 'admin') {
      const result = await this.adminModel.deleteOne({ _id: id, role: 'MANAGER' });
      if (result.deletedCount === 0) {
        throw new NotFoundException('المدير المطلوب غير موجود');
      }
    } else {
      const teacher = await this.teacherModel.findOne({ _id: id, isManager: true });
      if (!teacher) {
        throw new NotFoundException('المعلم المطلوب غير موجود أو ليس مديراً');
      }
      teacher.isManager = false;
      teacher.managerPermissions = [];
      await teacher.save();
    }
    return { success: true };
  }
}
