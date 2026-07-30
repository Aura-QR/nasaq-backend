import {
  IsString,
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsDateString,
  IsEnum,
  Matches,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The first name of the student' })
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The family name of the student' })
  familyName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The father name of the student' })
  fatherName: string;

  @IsDateString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The birth date of the student' })
  birthDate: string;

  @IsEnum(['male', 'female'])
  @IsNotEmpty()
  @ApiProperty({ description: 'The gender of the student' })
  gender: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The nationality of the student' })
  nationality: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9+\-\s()]+$/, { message: 'صيغة رقم الهاتف غير صحيحة' })
  @ApiProperty({ description: 'The phone number of the student' })
  phoneNumber: string;

  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ description: 'The email of the student' })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The address of the student' })
  address: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The previous school of the student', required: false })
  previousSchool?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({ description: 'The registration date of the student', required: false, example: '2026-01-01' })
  registrationDate?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The notes of the student', required: false })
  notes?: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'The active status of the student', required: false, example: true })
  isActive?: boolean;

  @IsString()
  @IsOptional()
  @MinLength(6, { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
  @ApiProperty({ description: 'The password of the student (optional, defaults to schoolEmail)', required: false })
  password?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The class ID of the student', required: false })
  classId?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Student status ("active" | "inactive")', required: false })
  status?: string;

  @IsArray()
  @IsOptional()
  @ApiProperty({ description: 'Subjects list (optional)', required: false })
  subjects?: any[];
}