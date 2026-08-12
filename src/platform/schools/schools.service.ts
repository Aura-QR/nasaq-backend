import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as mongoose from 'mongoose';
import { School } from './schemas/school.schema';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Permission } from 'src/permissions/schemas/permission.schema';
import { STUDENT_PERMISSIONS, TEACHER_PERMISSIONS } from 'src/permissions/default-permissions';
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
    return school.settings;
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

    const updateFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(settingsDto)) {
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

    return updated.settings;
  }
}
