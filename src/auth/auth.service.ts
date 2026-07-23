import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Student } from 'src/students/schemas/student.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { School } from 'src/platform/schools/schemas/school.schema';
import { LoginUserDto } from './dto/user.login.dto';
import { AuthJwtPayload } from './types/auth.jwtPayload';
import { Role } from './enums/role.enum';
import { PasswordUtil } from './utils/password.util';
import { PermissionsService } from 'src/permissions/permissions.service';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(Admin.name) private adminModel: Model<Admin>,
        @InjectModel(Student.name) private studentModel: Model<Student>,
        @InjectModel(Teacher.name) private teacherModel: Model<Teacher>,
        @InjectModel(School.name) private schoolModel: Model<School>,
        private jwtService: JwtService,
        private permissionsService: PermissionsService
    ){}

    async login(loginDto: LoginUserDto) {
        const { identifier, password } = loginDto;

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
}
