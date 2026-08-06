import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsNumber,
  IsOptional,
  IsMongoId,
  IsEnum,
  Min,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
// export enum AcademicLevel {
//   ELEMENTARY = 'elementary',
//   MIDDLE_SCHOOL = 'middle_school',
//   HIGH_SCHOOL = 'high_school',
// }

export class CreateSubjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The name of the subject' })
  subjectName: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The code of the subject' })
  subjectCode?: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Whether the subject is required for promotion', default: true })
  isRequiredForPromotion?: boolean;

  // @IsNumber()
  // @IsNotEmpty()
  // @Min(1)
  // weeklyHours: number;

  // @IsEnum(AcademicLevel)
  // @IsNotEmpty()
  // academicLevel: AcademicLevel;

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  @ApiProperty({ description: 'The class IDs of the subject' })
  classIds?: string[]; // Optional - subject can be in multiple classes

  // @IsString()
  // @IsNotEmpty()
  // @MinLength(4)
  // academicYear: string; // e.g., "2024-2025"

  // @IsString()
  // @IsOptional()
  // description?: string;
}