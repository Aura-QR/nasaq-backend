import {
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
export class ImportCurriculumDto {
  @IsMongoId() catalogSubjectId: string;
  @IsMongoId() subjectId: string;
  @IsMongoId() gradeLevelId: string;
}
export class CreateCurriculumUnitDto {
  @IsMongoId() subjectId: string;
  @IsMongoId() gradeLevelId: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name: string;
  @IsInt() @Min(0) order: number;
}
export class UpdateCurriculumUnitDto extends PartialType(
  OmitType(CreateCurriculumUnitDto, ['subjectId', 'gradeLevelId'] as const),
) {}
export class CreateCurriculumLessonDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name: string;
  @IsInt() @Min(0) order: number;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  objectives?: string[];
}
export class UpdateCurriculumLessonDto extends PartialType(
  CreateCurriculumLessonDto,
) {}
export class CurriculumQueryDto {
  @IsOptional() @IsMongoId() subjectId?: string;
  @IsOptional() @IsMongoId() gradeLevelId?: string;
}
