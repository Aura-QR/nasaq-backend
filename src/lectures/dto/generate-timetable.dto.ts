import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const GENERATE_MODES = ['preview', 'commit'] as const;
export const ON_EXISTING = ['skip', 'replace'] as const;

export class GenerateTimetableDto {
  @ApiProperty({ description: 'Term to generate for' })
  @IsMongoId()
  termId: string;

  @ApiPropertyOptional({
    description: 'Limit to these classes. Defaults to every active class in the term.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  classIds?: string[];

  @ApiPropertyOptional({
    description:
      'preview returns the proposed grid and writes nothing. commit inserts it.',
    enum: GENERATE_MODES,
    default: 'preview',
  })
  @IsOptional()
  @IsIn(GENERATE_MODES)
  mode?: (typeof GENERATE_MODES)[number];

  @ApiPropertyOptional({
    description:
      'What to do with a class that already has lectures this term. ' +
      'skip leaves it exactly as it is; replace deletes them first. ' +
      'skip is the default so a hand-built timetable is never overwritten by accident.',
    enum: ON_EXISTING,
    default: 'skip',
  })
  @IsOptional()
  @IsIn(ON_EXISTING)
  onExisting?: (typeof ON_EXISTING)[number];

  @ApiPropertyOptional({
    description:
      'How many periods of one subject a class may take in a single day. ' +
      'Soft: relaxed rather than failing if the week is too tight without it.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxSamePerDay?: number;

  @ApiPropertyOptional({
    description:
      'Also schedule subjects that have no teacher assigned, leaving teacherId ' +
      'null so the gap is visible on the timetable. On by default.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeUnstaffed?: boolean;
}
