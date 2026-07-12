import { IsString, MinLength, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPasswordDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @ApiProperty({ description: 'Student personal email' })
  email: string;

  @IsString()
  @ApiProperty({ description: '6-digit OTP sent to email' })
  otp: string;

  @IsString()
  @MinLength(6, { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
  @ApiProperty({ description: 'The new password for the student' })
  password: string;
}
