import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlatformAdmin } from './platform-admins/schemas/platform-admin.schema';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { JwtService } from '@nestjs/jwt';
import { LoginUserDto } from 'src/auth/dto/user.login.dto';

@Injectable()
export class PlatformAuthService {
  constructor(
    @InjectModel(PlatformAdmin.name) private platformAdminModel: Model<PlatformAdmin>,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginUserDto) {
    const { identifier, password } = loginDto;

    const user = await this.platformAdminModel
      .findOne({ email: identifier.toLowerCase().trim() })
      .select('+password');

    if (!user || !user.isActive) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    const isPasswordValid = await PasswordUtil.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    const payload = {
      sub: user._id.toString(),
      email: user.email,
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
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: 'SUPER_ADMIN',
      },
    };
  }
}
