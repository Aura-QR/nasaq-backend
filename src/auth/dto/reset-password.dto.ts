import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'البريد الإلكتروني للمستخدم', example: 'teacher@school.com' })
  @IsEmail({}, { message: 'يرجى إدخال بريد إلكتروني صحيح' })
  email: string;

  @ApiProperty({
    description: 'دور المستخدم',
    enum: ['TEACHER', 'STUDENT', 'OWNER', 'MANAGER', 'SUPERVISOR'],
    example: 'TEACHER',
  })
  @IsString()
  @IsIn(['TEACHER', 'STUDENT', 'OWNER', 'MANAGER', 'SUPERVISOR'], {
    message: 'دور المستخدم غير صالح',
  })
  role: string;

  @ApiProperty({ description: 'رمز التحقق المرسل إلى البريد الإلكتروني', example: '482910' })
  @IsString({ message: 'رمز التحقق يجب أن يكون نصاً' })
  otp: string;

  @ApiProperty({
    description: 'كلمة المرور الجديدة (6 أحرف على الأقل)',
    example: 'NewPass@2024',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
  newPassword: string;

  @ApiPropertyOptional({ description: 'معرّف المدرسة (اختياري)', example: 'my-school' })
  @IsOptional()
  @IsString()
  schoolSlug?: string;

  @ApiPropertyOptional({ description: 'معرف المدرسة المباشر (اختياري)' })
  @IsOptional()
  @IsString()
  schoolId?: string;
}
