import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ExamType } from '../../exams/enums/exam-type.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RESOURCE_TYPES } from '../schemas/preparation-resource.schema';

export class GeneratedExamOptionsDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
  @IsInt() @Min(1) @Max(240) duration: number;
  @IsInt() @Min(1) @Max(20) questionCount: number;
  @IsEnum(ExamType) examType: ExamType;
}

export class GeneratePreparationDto {
  @ApiPropertyOptional({ type: [String], enum: RESOURCE_TYPES, description: 'Only these additions are generated. [] means none. Omitted preserves legacy homework behavior.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(RESOURCE_TYPES, { each: true })
  resourceTypes?: (typeof RESOURCE_TYPES)[number][];

  @ApiPropertyOptional({ default: true, description: 'False generates only the selected additions.' })
  @IsOptional()
  @IsBoolean()
  includeContent?: boolean;

  @ApiPropertyOptional({ type: GeneratedExamOptionsDto })
  @IsOptional() @ValidateNested() @Type(() => GeneratedExamOptionsDto)
  exam?: GeneratedExamOptionsDto;
}
