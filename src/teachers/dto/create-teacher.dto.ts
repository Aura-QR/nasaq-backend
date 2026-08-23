import {
  IsString,
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsMongoId,
  IsDateString,
  Matches,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTeacherDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The name of the teacher' })
  name: string;

  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ description: 'The email of the teacher' })
  email: string;

  @IsString()
  @IsOptional()
  @Matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/, {
    message: 'رقم الهاتف يجب أن يكون صحيحاً',
  })
  @ApiProperty({ description: 'The phone number of the teacher' })
  phoneNumber?: string;

  /*
   * IGNORED ON WRITE. A Teacher document has no subject field: the relation is
   * teacher -> teacherAssignment -> subjectOffering -> subject, and a bare
   * subject id cannot name an offering (an offering is subject x grade x term).
   *
   * Kept only so an existing client sending it does not get a 400 from
   * forbidNonWhitelisted. Teacher reads DO return `subjects`, `subjectIds` and
   * `subjectOfferings`, joined from the assignment table.
   *
   * To change what a teacher teaches, send `subjectOfferingIds` to
   * PATCH /teachers/:id, or use POST/DELETE /teacher-assignments.
   */
  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  @ApiProperty({
    description: 'IGNORED on write. Read it back from the response instead.',
    required: false,
    deprecated: true,
  })
  subjectIds?: string[];

  /**
   * Replaces the teacher's assignments wholesale on PATCH /teachers/:id.
   * Omit it and the assignments are left alone; send [] to clear them.
   */
  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  @ApiProperty({
    description: 'Subject offerings this teacher teaches. Replaces the current set.',
    required: false,
    type: [String],
  })
  subjectOfferingIds?: string[];

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The qualification of the teacher' })
  qualification?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The experience of the teacher' })
  experience?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The specialization of the teacher' })
  specialization?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({ description: 'The hire date of the teacher', required: false })
  hireDate?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The address of the teacher', required: false })
  address?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Teacher status ("active" | "inactive")', required: false })
  status?: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'The active status of the teacher', required: false })
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  @ApiProperty({ description: 'Subjects list (optional)', required: false })
  subjects?: any[];

  @IsString()
  @IsOptional()
  @MinLength(6, { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
  @ApiProperty({ description: 'The password of the teacher', required: false })
  password?: string;
}