import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin } from 'src/admin/schemas/admin.schema';
import { Student } from 'src/students/schemas/student.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
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
        private jwtService: JwtService,
        private permissionsService: PermissionsService
    ){}

    async login(loginDto: LoginUserDto) {
        const { identifier, password } = loginDto;

        let user: any = null;
        let role: Role;

        user = await this.adminModel.findOne({
            $or: [{ email: identifier }, { username: identifier }]
        });

        if (user) {
            role = Role.ADMIN;
        } else {
            user = await this.teacherModel.findOne({ email: identifier });

            if (user) {
                role = Role.TEACHER;
                     } else {
                user = await this.studentModel.findOne({
                    $or: [{ email: identifier }, { schoolEmail: identifier }]
                }).select('+password');
                if (user) {
                    role = Role.STUDENT;
                }
            }
        }

        if (!user) {
            throw new UnauthorizedException('بيانات الدخول غير صحيحة');
        }

        // Student without a password must set one first via admin
        if (role === Role.STUDENT && !user.hasPassword) {
            throw new UnauthorizedException('لم يتم تعيين كلمة مرور لهذا الحساب بعد، يرجى التواصل مع الإدارة');
        }

        const isPasswordValid = await PasswordUtil.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('بيانات الدخول غير صحيحة');
        }

        const payload: AuthJwtPayload = {
            sub: user._id.toString(),
            email: user.email,
            role: role
        };

        const accessToken = await this.jwtService.signAsync(payload);

        const permissions = await this.permissionsService.getPermissionsByRole(role);

        return {
            accessToken,
            requiresPasswordSetup: false,
            user: {
                id: user._id,
                email: user.email,
                role: role
            },
            permissions
        };
    }
}
