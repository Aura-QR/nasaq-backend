import {
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// Multipart clients may send arrays as JSON; ordinary JSON arrays pass through.
const arrayValue = ({ value }: { value: any }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
export class StructuredPreparationDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() lessonId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  warmUp?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  vocabulary?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  strategiesOther?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  thinkingSkills?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  closure?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  teacherInstructions?: string;
  @ApiPropertyOptional({ type: [String] })
  @Transform(arrayValue)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  objectives?: string[];
  @ApiPropertyOptional({ type: [String] })
  @Transform(arrayValue)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  teachingStrategies?: string[];
  @ApiPropertyOptional({ type: [String] })
  @Transform(arrayValue)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  teachingAids?: string[];
  @ApiPropertyOptional({ type: [String] })
  @Transform(arrayValue)
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  digitalContentIds?: string[];
}
