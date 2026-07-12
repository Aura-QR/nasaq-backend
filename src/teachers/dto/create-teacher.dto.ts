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
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class CreateTeacherDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The name of the teacher' })
  name: string;

  // @IsString()
  // @IsNotEmpty()
  // @MinLength(2)
  // @ApiProperty({ description: 'The last name of the teacher' })
  // lastName: string;

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

  @IsArray()
  @ArrayMinSize(1, { message: 'يجب تعيين المعلم لمادة واحدة على الأقل' })
  @IsMongoId({ each: true })
  @ApiProperty({ description: 'The subject IDs of the teacher' })
  subjectIds: string[]; //  Teacher must be assigned to at least one subject

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The qualification of the teacher' })
  qualification?: string; // "Bachelor's in Mathematics", "PhD in Physics"

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The experience of the teacher' })
  experience?: string; //"5 years", "10+ years"

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The specialization of the teacher' })
  specialization?: string; //  "Secondary Education", "Primary Mathematics"

  @IsDateString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The hire date of the teacher' })
  hireDate: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The address of the teacher' })
  address?: string;

  @IsBoolean()
  @IsNotEmpty()
  @ApiProperty({ description: 'The active status of the teacher' })
  isActive: boolean;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
  @ApiProperty({ description: 'The password of the teacher' })
  password: string;
}