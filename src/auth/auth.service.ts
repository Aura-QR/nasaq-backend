import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Student } from 'src/students/schemas/student.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { School } from 'src/platform/schools/schemas/school.schema';
import { LoginUserDto } from './dto/user.login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthJwtPayload } from './types/auth.jwtPayload';
import { Role } from './enums/role.enum';
import { PasswordUtil } from './utils/password.util';
import { PermissionsService } from 'src/permissions/permissions.service';
import { EmailService } from 'src/email/email.service';

import { PlatformAdmin } from 'src/platform/platform-admins/schemas/platform-admin.schema';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(Admin.name) private adminModel: Model<Admin>,
        @InjectModel(Student.name) private studentModel: Model<Student>,
        @InjectModel(Teacher.name) private teacherModel: Model<Teacher>,
        @InjectModel(School.name) private schoolModel: Model<School>,
        @InjectModel(PlatformAdmin.name) private platformAdminModel: Model<PlatformAdmin>,
        private jwtService: JwtService,
        private permissionsService: PermissionsService,
        private emailService: EmailService,
    ){}

    async login(loginDto: LoginUserDto) {
        const { identifier, password } = loginDto;

        // 1. Check Platform Super Admin
        const platformAdmin = await this.platformAdminModel
            .findOne({ email: identifier.toLowerCase().trim() })
            .select('+password');

        if (platformAdmin && platformAdmin.isActive) {
            const isPasswordValid = await PasswordUtil.compare(password, platformAdmin.password);
            if (isPasswordValid) {
                const payload: AuthJwtPayload = {
                    sub: platformAdmin._id.toString(),
                    email: platformAdmin.email,
                    role: 'SUPER_ADMIN',
                    schoolId: null,
                    permissions: [
                        'platform.schools.manage',
                        'platform.subscriptions.manage',
                        'platform.plans.manage',
                        'platform.analytics.view',
                    ],
                };
                const accessToken = await this.jwtService.signAsync(payload);
                return {
                    accessToken,
                    requiresPasswordSetup: false,
                    user: {
                        id: platformAdmin._id,
                        name: platformAdmin.name,
                        email: platformAdmin.email,
                        role: 'SUPER_ADMIN',
                        schoolId: null,
                    },
                    permissions: payload.permissions,
                };
            }
        }

        let filterSchoolId: any = null;
        if (loginDto.schoolSlug) {
            const school = await this.schoolModel.findOne({ slug: loginDto.schoolSlug.toLowerCase().trim() })
                .setOptions({ skipTenantScope: true });
            if (school) {
                filterSchoolId = school._id;
            } else {
                throw new UnauthorizedException('المدرسة المطلوبة غير موجودة');
            }
        } else if (loginDto.schoolId) {
            filterSchoolId = loginDto.schoolId;
        }

        let user: any = null;
        let role: string;

        // Lookup Admin/Owner/Manager
        const adminQuery: any = {
            $or: [{ email: identifier }, { username: identifier }]
        };
        if (filterSchoolId) {
            adminQuery.schoolId = filterSchoolId;
        }
        const admins = await this.adminModel.find(adminQuery).setOptions({ skipTenantScope: true });

        if (admins.length > 0) {
            if (admins.length > 1 && !filterSchoolId) {
                throw new UnauthorizedException('تم العثور على حسابات متعددة بالبريد الإلكتروني هذا. يرجى تحديد المدرسة.');
            }
            user = admins[0];
            role = user.role;
        } else {
            // Lookup Teacher
            const teacherQuery: any = { email: identifier };
            if (filterSchoolId) {
                teacherQuery.schoolId = filterSchoolId;
            }
            const teachers = await this.teacherModel.find(teacherQuery).setOptions({ skipTenantScope: true });

            if (teachers.length > 0) {
                if (teachers.length > 1 && !filterSchoolId) {
                    throw new UnauthorizedException('تم العثور على حسابات متعددة بالبريد الإلكتروني هذا. يرجى تحديد المدرسة.');
                }
                user = teachers[0];
                role = Role.TEACHER;
            } else {
                // Lookup Student
                const studentQuery: any = {
                    $or: [{ email: identifier }, { schoolEmail: identifier }]
                };
                if (filterSchoolId) {
                    studentQuery.schoolId = filterSchoolId;
                }
                const students = await this.studentModel.find(studentQuery)
                    .select('+password')
                    .setOptions({ skipTenantScope: true });

                if (students.length > 0) {
                    if (students.length > 1 && !filterSchoolId) {
                        throw new UnauthorizedException('تم العثور على حسابات متعددة بالبريد الإلكتروني هذا. يرجى تحديد المدرسة.');
                    }
                    user = students[0];
                    role = Role.STUDENT;
                }
            }
        }

        if (!user) {
            throw new UnauthorizedException('بيانات الدخول غير صحيحة');
        }

        // Verify school active status
        if (user.schoolId) {
            const school = await this.schoolModel.findById(user.schoolId)
                .setOptions({ skipTenantScope: true })
                .lean();
            if (!school) {
                throw new UnauthorizedException('المدرسة التابع لها هذا الحساب غير موجودة');
            }
            if (!school.isActive) {
                throw new UnauthorizedException('المدرسة معطلة حالياً، يرجى مراجعة الإدارة');
            }
        }

        // Student without a password must set one first via admin
        if (role === Role.STUDENT && !user.hasPassword) {
            throw new UnauthorizedException('لم يتم تعيين كلمة مرور لهذا الحساب بعد، يرجى التواصل مع الإدارة');
        }

        const isPasswordValid = await PasswordUtil.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('بيانات الدخول غير صحيحة');
        }

        // Fetch flat permissions
        let permissions: string[] = [];
        if (role === 'OWNER' || role === 'SUPERVISOR') {
            permissions = ['*'];
        } else if (role === 'MANAGER') {
            permissions = user.permissions || [];
        } else if (role === Role.TEACHER) {
            const basePerms = await this.permissionsService.getFlatPermissions(
                Role.TEACHER,
                user.schoolId?.toString()
            );
            if (user.isManager && user.managerPermissions) {
                permissions = Array.from(new Set([...basePerms, ...user.managerPermissions]));
            } else {
                permissions = basePerms;
            }
        } else {
            permissions = await this.permissionsService.getFlatPermissions(
                role,
                user.schoolId?.toString(),
                user._id.toString()
            );
        }

        const payload: AuthJwtPayload = {
            sub: user._id.toString(),
            email: user.email,
            role: role,
            schoolId: user.schoolId ? user.schoolId.toString() : null,
            permissions: permissions,
        };

        const accessToken = await this.jwtService.signAsync(payload);

        return {
            accessToken,
            requiresPasswordSetup: false,
            user: {
                id: user._id,
                email: user.email,
                role: role,
                schoolId: user.schoolId
            },
            permissions
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORGOT PASSWORD — sends a 6-digit OTP to the user's registered email
    // Works for: TEACHER | STUDENT | OWNER | MANAGER | SUPERVISOR
    // Uses skipTenantScope for cross-tenant lookup by email
    // Always returns a generic message regardless of whether the email exists
    // (prevents email enumeration)
    // ─────────────────────────────────────────────────────────────────────────
    async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
        const { email, role, schoolSlug, schoolId: rawSchoolId } = dto;
        const cleanEmail = email.toLowerCase().trim();

        // Resolve optional schoolId to narrow cross-tenant lookups
        let filterSchoolId: any = rawSchoolId || null;
        if (schoolSlug) {
            const school = await this.schoolModel
                .findOne({ slug: schoolSlug.toLowerCase().trim() })
                .setOptions({ skipTenantScope: true });
            if (school) filterSchoolId = school._id;
        }

        // Generic response — never reveal whether the email is registered
        const genericResponse = {
            message: 'إذا كان البريد الإلكتروني مسجلاً، سيتم إرسال رمز التحقق إليه خلال لحظات',
        };

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        try {
            if (role === Role.TEACHER) {
                const query: any = { email: cleanEmail };
                if (filterSchoolId) query.schoolId = filterSchoolId;

                const teacher = await this.teacherModel
                    .findOne(query)
                    .setOptions({ skipTenantScope: true });
                if (!teacher) return genericResponse;

                await this.teacherModel.findByIdAndUpdate(
                    teacher._id,
                    { $set: { otp, otpExpiry } },
                    { skipTenantScope: true },
                );
                await this.emailService.sendPasswordResetOtp(teacher.email, otp);

            } else if (role === Role.STUDENT) {
                const query: any = { $or: [{ email: cleanEmail }, { schoolEmail: cleanEmail }] };
                if (filterSchoolId) query.schoolId = filterSchoolId;

                const student = await this.studentModel
                    .findOne(query)
                    .setOptions({ skipTenantScope: true });
                if (!student) return genericResponse;

                await this.studentModel.findByIdAndUpdate(
                    student._id,
                    { $set: { otp, otpExpiry } },
                    { skipTenantScope: true },
                );
                await this.emailService.sendPasswordResetOtp(student.email, otp);

            } else if (
                role === 'OWNER' ||
                role === 'MANAGER' ||
                role === 'SUPERVISOR'
            ) {
                const query: any = { email: cleanEmail };
                if (filterSchoolId) query.schoolId = filterSchoolId;

                const admin = await this.adminModel
                    .findOne(query)
                    .setOptions({ skipTenantScope: true });
                if (!admin) return genericResponse;

                await this.adminModel.findByIdAndUpdate(
                    admin._id,
                    { $set: { otp, otpExpiry } },
                    { skipTenantScope: true },
                );
                await this.emailService.sendPasswordResetOtp(admin.email, otp);

            } else {
                throw new BadRequestException('دور المستخدم غير صالح');
            }
        } catch (err) {
            // Re-throw validation errors; swallow transient failures (e.g. email delivery)
            if (err instanceof BadRequestException) throw err;
        }

        return genericResponse;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESET PASSWORD — validates OTP then sets the new hashed password
    // Works for: TEACHER | STUDENT | OWNER | MANAGER | SUPERVISOR
    // Uses skipTenantScope for cross-tenant lookup by email
    // ─────────────────────────────────────────────────────────────────────────
    async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
        const { email, role, otp, newPassword, schoolSlug, schoolId: rawSchoolId } = dto;
        const cleanEmail = email.toLowerCase().trim();

        // Resolve optional schoolId
        let filterSchoolId: any = rawSchoolId || null;
        if (schoolSlug) {
            const school = await this.schoolModel
                .findOne({ slug: schoolSlug.toLowerCase().trim() })
                .setOptions({ skipTenantScope: true });
            if (school) filterSchoolId = school._id;
        }

        const hashedPassword = await PasswordUtil.hash(newPassword);

        if (role === Role.TEACHER) {
            const query: any = { email: cleanEmail };
            if (filterSchoolId) query.schoolId = filterSchoolId;

            const teacher = await this.teacherModel
                .findOne(query)
                .select('+otp +otpExpiry')
                .setOptions({ skipTenantScope: true });

            if (!teacher) throw new NotFoundException('البريد الإلكتروني غير مسجل');
            this.validateOtp(teacher.otp, teacher.otpExpiry, otp);

            await this.teacherModel.findByIdAndUpdate(
                teacher._id,
                { $set: { password: hashedPassword }, $unset: { otp: '', otpExpiry: '' } },
                { skipTenantScope: true },
            );

        } else if (role === Role.STUDENT) {
            const query: any = { $or: [{ email: cleanEmail }, { schoolEmail: cleanEmail }] };
            if (filterSchoolId) query.schoolId = filterSchoolId;

            const student = await this.studentModel
                .findOne(query)
                .select('+otp +otpExpiry')
                .setOptions({ skipTenantScope: true });

            if (!student) throw new NotFoundException('البريد الإلكتروني غير مسجل');
            this.validateOtp(student.otp, student.otpExpiry, otp);

            await this.studentModel.findByIdAndUpdate(
                student._id,
                {
                    $set: { password: hashedPassword, hasPassword: true },
                    $unset: { otp: '', otpExpiry: '' },
                },
                { skipTenantScope: true },
            );

        } else if (
            role === 'OWNER' ||
            role === 'MANAGER' ||
            role === 'SUPERVISOR'
        ) {
            const query: any = { email: cleanEmail };
            if (filterSchoolId) query.schoolId = filterSchoolId;

            const admin = await this.adminModel
                .findOne(query)
                .select('+otp +otpExpiry')
                .setOptions({ skipTenantScope: true });

            if (!admin) throw new NotFoundException('البريد الإلكتروني غير مسجل');
            this.validateOtp(admin.otp, admin.otpExpiry, otp);

            await this.adminModel.findByIdAndUpdate(
                admin._id,
                { $set: { password: hashedPassword }, $unset: { otp: '', otpExpiry: '' } },
                { skipTenantScope: true },
            );

        } else {
            throw new BadRequestException('دور المستخدم غير صالح');
        }

        return { message: 'تم تغيير كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Validates that a stored OTP:
     * 1. Exists (user has requested an OTP)
     * 2. Has not expired (15-minute window)
     * 3. Matches the value provided by the user
     */
    private validateOtp(
        storedOtp: string | undefined,
        storedExpiry: Date | undefined,
        providedOtp: string,
    ): void {
        if (!storedOtp || !storedExpiry) {
            throw new BadRequestException('يرجى طلب رمز التحقق أولاً');
        }
        if (new Date() > storedExpiry) {
            throw new BadRequestException('انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد');
        }
        if (storedOtp !== providedOtp) {
            throw new BadRequestException('رمز التحقق غير صحيح');
        }
    }
}
