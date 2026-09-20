import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const LATE_REASON_VERDICTS = ['accepted', 'rejected'] as const;

/**
 * The school's ruling on a teacher's account of a lateness.
 *
 * Without one the explanation is written into a field nobody answers, and a
 * teacher who gave a good reason has no way to know it was accepted.
 */
export class ReviewLateReasonDto {
  @ApiProperty({ enum: LATE_REASON_VERDICTS })
  @IsIn(LATE_REASON_VERDICTS as unknown as string[], {
    message: 'القرار يجب أن يكون accepted أو rejected',
  })
  verdict: (typeof LATE_REASON_VERDICTS)[number];

  /**
   * Required for a refusal.
   *
   * Refusing an explanation without saying why leaves the teacher with a mark
   * on their record and nothing to answer.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Filters for the review list. */
export class ListLateReasonsDto {
  @ApiPropertyOptional({ enum: ['pending', 'accepted', 'rejected', 'missing'] })
  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected', 'missing'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  teacherId?: string;
}
