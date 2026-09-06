import { IsString, MinLength, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PASSWORD_MIN_LENGTH_MESSAGE } from '../../auth/constants/password.constants';

export class SetPasswordDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @ApiProperty({ description: 'Student personal email' })
  email: string;

  @IsString()
  @ApiProperty({ description: '6-digit OTP sent to email' })
  otp: string;

  @IsString()
  @MinLength(6, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @ApiProperty({ description: 'The new password for the student' })
  password: string;
}
