import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class ForgotPasswordDto {
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

  @ApiPropertyOptional({
    description: 'معرّف المدرسة (اختياري - لتحديد المدرسة عند تكرار البريد)',
    example: 'my-school',
  })
  @IsOptional()
  @IsString()
  schoolSlug?: string;

  @ApiPropertyOptional({
    description: 'معرف المدرسة المباشر (اختياري)',
  })
  @IsOptional()
  @IsString()
  schoolId?: string;
}
