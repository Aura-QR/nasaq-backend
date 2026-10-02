import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { CreateStaffMemberDto, UpdateStaffMemberDto } from './dto/staff-member.dto';

/**
 * موظفو الخدمات — a guard, a cleaner, a driver.
 *
 * Admin accounts with role STAFF. They keep the school's hours and are
 * tracked by staff attendance like the administrators, but hold no school
 * permission: signing in gives them their own check-in and nothing else.
 *
 * Kept apart from ManagersService on purpose. That service carries the
 * rules for who may edit an owner or a supervisor; this one must only ever
 * touch STAFF, so every query here is pinned to that role and an id that
 * belongs to a manager simply is not found.
 */
@Injectable()
export class StaffMembersService {
  constructor(@InjectModel(Admin.name) private readonly adminModel: Model<Admin>) {}

  private static readonly ROLE = 'STAFF';

  private static view(a: any) {
    return {
      id: String(a._id),
      fullName: a.fullName || '',
      username: a.username,
      email: a.email,
      jobLabel: a.jobLabel || '',
      // A placeholder address cannot receive a reset code.
      hasEmail: !String(a.email || '').endsWith('.staff.local'),
      createdAt: a.createdAt,
    };
  }

  private static oid(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('معرّف الموظف غير صالح');
    return new Types.ObjectId(id);
  }

  async list() {
    const rows = await this.adminModel
      .find({ role: StaffMembersService.ROLE })
      .select('fullName username email jobLabel createdAt')
      .sort({ fullName: 1, username: 1 })
      .lean()
      .exec();
    return { status: true, message: 'تم استرجاع موظفي الخدمات', data: rows.map(StaffMembersService.view) };
  }

  async create(schoolId: string, dto: CreateStaffMemberDto) {
    const username = dto.username.trim();
    // Admin requires an email and indexes it as unique. A guard often has
    // none, so one is generated that is unique because the username is.
    const email = (dto.email?.trim().toLowerCase()) || `${username.toLowerCase()}@${schoolId}.staff.local`;

    const taken = await this.adminModel
      .findOne({ $or: [{ email }, { username }] })
      .setOptions({ skipTenantScope: true })
      .select('_id')
      .lean()
      .exec();
    if (taken) throw new ConflictException('اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل');

    const created = await this.adminModel.create({
      username,
      email,
      fullName: dto.fullName.trim(),
      jobLabel: (dto.jobLabel ?? '').trim(),
      password: await PasswordUtil.hash(dto.password),
      role: StaffMembersService.ROLE,
      // Nothing. Their one action — their own attendance — is guarded by role.
      permissions: [],
      schoolId: new Types.ObjectId(schoolId),
    });

    return { status: true, message: 'تمت إضافة الموظف', data: StaffMembersService.view(created) };
  }

  async update(id: string, dto: UpdateStaffMemberDto) {
    const staff = await this.adminModel.findOne({ _id: StaffMembersService.oid(id), role: StaffMembersService.ROLE });
    if (!staff) throw new NotFoundException('الموظف غير موجود');

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const taken = await this.adminModel
        .findOne({ email, _id: { $ne: staff._id } })
        .setOptions({ skipTenantScope: true })
        .select('_id')
        .lean()
        .exec();
      if (taken) throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
      staff.email = email;
    }
    if (dto.fullName !== undefined) staff.fullName = dto.fullName.trim();
    if (dto.jobLabel !== undefined) staff.jobLabel = dto.jobLabel.trim();
    if (dto.password) staff.password = await PasswordUtil.hash(dto.password);

    await staff.save();
    return { status: true, message: 'تم تحديث بيانات الموظف', data: StaffMembersService.view(staff) };
  }

  /**
   * Removes the account. Attendance already recorded keeps the name it was
   * written with, so past reports still read correctly.
   */
  async remove(id: string) {
    const result = await this.adminModel.deleteOne({
      _id: StaffMembersService.oid(id),
      role: StaffMembersService.ROLE,
    });
    if (!result.deletedCount) throw new NotFoundException('الموظف غير موجود');
    return { status: true, message: 'تم حذف الموظف', data: { id } };
  }
}
