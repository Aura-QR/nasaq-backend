import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/user.login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Public()
    @Post('login')
    @ApiOperation({ summary: 'تسجيل دخول المستخدم (معلم / طالب / مدير / صاحب مدرسة)' })
    @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح' })
    @ApiResponse({ status: 400, description: 'بيانات غير صحيحة' })
    @ApiResponse({ status: 401, description: 'بيانات الدخول خاطئة' })
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginUserDto: LoginUserDto) {
        return await this.authService.login(loginUserDto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORGOT PASSWORD
    // ─────────────────────────────────────────────────────────────────────────
    @Public()
    @Post('forgot-password')
    @ApiOperation({
        summary: 'طلب رمز OTP لإعادة تعيين كلمة المرور',
        description:
            'يرسل رمز تحقق مدته 15 دقيقة إلى البريد الإلكتروني المسجل. ' +
            'يعمل مع جميع أنواع المستخدمين (معلم، طالب، مدير). ' +
            'يُرجع دائماً رسالة نجاح عامة لحماية الخصوصية.',
    })
    @ApiResponse({ status: 200, description: 'رمز التحقق أُرسل إلى البريد الإلكتروني (إذا كان مسجلاً)' })
    @ApiResponse({ status: 400, description: 'بيانات غير صحيحة أو دور مستخدم غير صالح' })
    @HttpCode(HttpStatus.OK)
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        return await this.authService.forgotPassword(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESET PASSWORD
    // ─────────────────────────────────────────────────────────────────────────
    @Public()
    @Post('reset-password')
    @ApiOperation({
        summary: 'إعادة تعيين كلمة المرور باستخدام رمز OTP',
        description:
            'يتحقق من رمز OTP المُرسل إلى البريد الإلكتروني ثم يحدّث كلمة المرور. ' +
            'الرمز صالح 15 دقيقة فقط. يعمل مع جميع أنواع المستخدمين.',
    })
    @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور بنجاح' })
    @ApiResponse({ status: 400, description: 'رمز التحقق غير صحيح أو منتهي الصلاحية' })
    @ApiResponse({ status: 404, description: 'البريد الإلكتروني غير مسجل' })
    @HttpCode(HttpStatus.OK)
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return await this.authService.resetPassword(dto);
    }
}
