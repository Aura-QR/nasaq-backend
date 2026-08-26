import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as mongoose from 'mongoose';
import { School } from './schemas/school.schema';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Permission } from 'src/permissions/schemas/permission.schema';
import { WEEKDAYS } from './schemas/school.schema';
import {
  MANAGER_PERMISSIONS,
  STUDENT_PERMISSIONS,
  TEACHER_PERMISSIONS,
} from 'src/permissions/default-permissions';
import { RegisterSchoolDto } from './dto/register-school.dto';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from 'src/tenancy/tenant-context.service';

import { Inject, Optional, forwardRef } from '@nestjs/common';
import { FinancialRecordService } from 'src/financial/financial-record.service';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectModel(School.name) private schoolModel: Model<School>,
    @InjectModel(Admin.name) private adminModel: Model<Admin>,
    @InjectModel(Permission.name) private permissionModel: Model<Permission>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
    @Optional() @Inject(forwardRef(() => FinancialRecordService)) private readonly financialRecordService?: FinancialRecordService,
  ) {}

  async register(dto: RegisterSchoolDto) {
    const slug = dto.slug.toLowerCase().trim();

    // Check slug uniqueness globally
    const existingSchool = await this.schoolModel
      .findOne({ slug })
      .setOptions({ skipTenantScope: true });
    if (existingSchool) {
      throw new ConflictException('الرابط التعريفي للمدرسة مستخدم بالفعل');
    }

    // Check admin email/username uniqueness globally
    const existingAdmin = await this.adminModel
      .findOne({
        $or: [{ email: dto.ownerEmail }, { username: dto.ownerUsername }],
      })
      .setOptions({ skipTenantScope: true });
    if (existingAdmin) {
      throw new ConflictException('البريد الإلكتروني أو اسم المستخدم لمدير المدرسة مستخدم بالفعل');
    }

    // Step 1: Create the school (no tenantScopedPlugin — safe to run outside context)
    const school = await new this.schoolModel({
      name: dto.schoolName,
      slug,
      email: dto.schoolEmail,
      phone: dto.phone,
      subscriptionStatus: 'trialing',
      isActive: true,
    }).save();

    const schoolId = school._id.toString();

    let owner: any;
    try {
      // Steps 2-5: Run inside a tenant context so tenantScopedPlugin is satisfied
      const result = await this.tenantContext.runWithTenant(
        schoolId,
        false,
        async () => {
          // 2. Hash owner password
          const hashedPassword = await PasswordUtil.hash(dto.ownerPassword);

          // 3. Create the Owner Admin document (tenantScopedPlugin will auto-stamp schoolId)
          const owner = await new this.adminModel({
            username: dto.ownerUsername,
            email: dto.ownerEmail,
            password: hashedPassword,
            role: 'OWNER',
            schoolId: school._id,
          }).save();

          // 4. Link Owner to the School
          school.ownerId = owner._id as any;
          await school.save();

          // 5. Seed default permissions for the school.
          //
          // These tables live in src/permissions/default-permissions.ts and MUST NOT be
          // inlined here again. They used to be, and because this path is what every real
          // school is seeded from, the copy in PermissionsService was only ever a fallback
          // — editing it changed nothing for anybody, with no error to show for it.
          await this.permissionModel.create([
            { role: 'MANAGER', schoolId: school._id, permissions: MANAGER_PERMISSIONS },
            { role: 'TEACHER', schoolId: school._id, permissions: TEACHER_PERMISSIONS },
            { role: 'STUDENT', schoolId: school._id, permissions: STUDENT_PERMISSIONS },
          ]);

          return { owner };
        },
      );
      owner = result.owner;
    } catch (error) {
      // Rollback orphaned school & owner admin if secondary steps fail
      await this.adminModel.deleteMany({ schoolId: school._id }).setOptions({ skipTenantScope: true });
      await this.schoolModel.findByIdAndDelete(school._id).setOptions({ skipTenantScope: true });
      throw error;
    }

    const tokenPayload = {
      sub: owner._id.toString(),
      email: owner.email,
      role: 'OWNER',
      schoolId: school._id.toString(),
      permissions: ['*'],
    };

    const accessToken = await this.jwtService.signAsync(tokenPayload);

    return {
      accessToken,
      user: {
        id: owner._id,
        username: owner.username,
        email: owner.email,
        role: 'OWNER',
        schoolId: school._id,
      },
      school: {
        id: school._id,
        name: school.name,
        slug: school.slug,
      },
    };
  }

  async findAll() {
    return this.schoolModel.find().setOptions({ skipTenantScope: true }).lean();
  }

  async findOne(id: string) {
    const school = await this.schoolModel.findById(id).setOptions({ skipTenantScope: true }).lean();
    if (!school) {
      throw new NotFoundException(`المدرسة بمعرف ${id} غير موجودة`);
    }

    const schoolObjectId = new mongoose.Types.ObjectId(id);
    const db = this.connection.db;

    const [
      studentCount,
      teacherCount,
      subjectCount,
      bookCount,
      classCount,
      managerCount,
      examCount,
      projectCount,
      ownerAdmin,
    ] = await Promise.all([
      db.collection('students').countDocuments({ schoolId: schoolObjectId }),
      db.collection('teachers').countDocuments({ schoolId: schoolObjectId }),
      db.collection('subjects').countDocuments({ schoolId: schoolObjectId }),
      db.collection('libraries').countDocuments({ schoolId: schoolObjectId }),
      db.collection('classes').countDocuments({ schoolId: schoolObjectId }),
      db.collection('admins').countDocuments({ schoolId: schoolObjectId, role: { $in: ['MANAGER', 'SUPERVISOR'] } }),
      db.collection('exams').countDocuments({ schoolId: schoolObjectId }),
      db.collection('projects').countDocuments({ schoolId: schoolObjectId }),
      db.collection('admins').findOne({ schoolId: schoolObjectId, role: 'OWNER' }, { projection: { password: 0 } }),
    ]);

    return {
      ...school,
      owner: ownerAdmin
        ? {
            id: ownerAdmin._id,
            username: ownerAdmin.username,
            email: ownerAdmin.email,
          }
        : null,
      stats: {
        students: studentCount,
        teachers: teacherCount,
        subjects: subjectCount,
        books: bookCount,
        classes: classCount,
        managers: managerCount,
        exams: examCount,
        projects: projectCount,
      },
    };
  }

  async update(id: string, updateDto: any) {
    return this.schoolModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .setOptions({ skipTenantScope: true });
  }

  async getMySettings(schoolId: string) {
    const school = await this.schoolModel
      .findById(schoolId, { settings: 1 })
      .setOptions({ skipTenantScope: true })
      .lean();
    if (!school) {
      throw new NotFoundException(`المدرسة غير موجودة`);
    }
    return withDerivedWorkStartTime(school.settings);
  }

  async updateMySettings(schoolId: string, settingsDto: Partial<Record<string, any>>) {
    if (settingsDto.teacherCheckInEnabled === true) {
      const school = await this.schoolModel
        .findById(schoolId, { settings: 1 })
        .setOptions({ skipTenantScope: true })
        .lean();

      const effectiveLocation = settingsDto.location !== undefined ? settingsDto.location : school?.settings?.location;
      if (!effectiveLocation || typeof effectiveLocation.lat !== 'number' || typeof effectiveLocation.lng !== 'number') {
        throw new BadRequestException('لا يمكن تفعيل خدمة التسجيل الذاتي دون تحديد موقع المدرسة');
      }
    }

    /*
     * workStartTime is the shape this setting shipped in first, and a client
     * is already sending it. It is one time for the whole week, which cannot
     * express a short day or a day off, so the stored model is workSchedule —
     * seven days, each with its own hours and an isWorkingDay flag.
     *
     * Rather than break the client that got there first, a workStartTime is
     * translated into the schedule here. Both keys in one request is a
     * contradiction, so the explicit schedule wins and the shorthand is
     * dropped.
     */
    const dto: Record<string, any> = { ...settingsDto };
    if (dto.workStartTime !== undefined) {
      const shorthand = dto.workStartTime;
      delete dto.workStartTime;

      if (dto.workSchedule === undefined) {
        const existing = await this.schoolModel
          .findById(schoolId, { settings: 1 })
          .setOptions({ skipTenantScope: true })
          .lean();

        dto.workSchedule = applyStartTimeToSchedule(
          (existing?.settings as any)?.workSchedule,
          shorthand,
        );
      }
    }

    const updateFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      updateFields[`settings.${key}`] = value;
    }

    const updated = await this.schoolModel
      .findByIdAndUpdate(schoolId, { $set: updateFields }, { new: true, select: 'settings' })
      .setOptions({ skipTenantScope: true })
      .lean();

    if (!updated) {
      throw new NotFoundException(`المدرسة غير موجودة`);
    }

    if (settingsDto.localNationalityCodes && this.financialRecordService) {
      await this.financialRecordService.recalculateForSchool(schoolId);
    }

    return withDerivedWorkStartTime(updated.settings);
  }
}

/**
 * Set one start time across the week, in the shape the schedule stores.
 *
 * With no schedule yet, all seven days are created as working days — exactly
 * what a single workStartTime meant, since it had no notion of a day off. The
 * school marks its weekend when it edits the schedule properly.
 *
 * null clears the start times and leaves the working/not-working flags alone.
 */
function applyStartTimeToSchedule(
  existing: any[] | undefined,
  startTime: string | null,
): any[] {
  const base =
    Array.isArray(existing) && existing.length
      ? existing.map((d) => ({
          day: d.day,
          isWorkingDay: d.isWorkingDay !== false,
          startTime: d.startTime ?? null,
          endTime: d.endTime ?? null,
        }))
      : WEEKDAYS.map((day) => ({
          day,
          isWorkingDay: true,
          startTime: null,
          endTime: null,
        }));

  return base.map((d) => ({
    ...d,
    // A day off has no hours to set, whatever the shorthand says.
    startTime: d.isWorkingDay ? startTime : null,
  }));
}

/**
 * Report the week's start time as a single value when there is one.
 *
 * A client written against the original shape reads `workStartTime` back after
 * saving. Returning null when the working days genuinely differ is the honest
 * answer — a short Thursday cannot be reported as one time, and picking one of
 * them would be a lie the client would then write back over the others.
 */
function withDerivedWorkStartTime(settings: any): any {
  if (!settings) return settings;

  const schedule = settings.workSchedule;
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return { ...settings, workStartTime: null };
  }

  const startTimes = schedule
    .filter((d: any) => d?.isWorkingDay !== false)
    .map((d: any) => d?.startTime ?? null);

  const allSame =
    startTimes.length > 0 && startTimes.every((t) => t === startTimes[0]);

  return { ...settings, workStartTime: allSame ? startTimes[0] : null };
}
