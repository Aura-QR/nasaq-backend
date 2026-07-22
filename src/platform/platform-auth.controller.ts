import { Controller, Post, Body } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { LoginUserDto } from 'src/auth/dto/user.login.dto';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  @Public()
  @Post('login')
  async login(@Body() loginDto: LoginUserDto) {
    return this.platformAuthService.login(loginDto);
  }
}
