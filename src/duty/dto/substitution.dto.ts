import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { COVER_REASONS, CoverReason } from '../schemas/substitution.schema';

export class CreateSubstitutionDto {
  @ApiProperty({ description: 'The day, YYYY-MM-DD', example: '2026-09-02' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date لازم يكون بصيغة YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'Lecture being covered' })
  @IsMongoId()
  lectureId: string;

  @ApiProperty({ description: 'Who is taking it' })
  @IsMongoId()
  substituteTeacherId: string;

  @ApiPropertyOptional({ enum: COVER_REASONS, default: 'absent' })
  @IsOptional()
  @IsEnum(COVER_REASONS)
  reason?: CoverReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
