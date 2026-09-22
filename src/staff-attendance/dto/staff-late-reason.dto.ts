import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const STAFF_LATE_REASON_VERDICTS = ['accepted', 'rejected'] as const;

/**
 * A staff member's own account of why they were late.
 *
 * The same shape the teacher queue uses, deliberately: a manager reviewing
 * both should not have to learn two screens, and a client already reading one
 * payload should not have to special-case the other.
 */
export class SubmitStaffLateReasonDto {
  @ApiProperty({ example: 'ازدحام مروري على طريق المدرسة' })
  @IsString()
  @IsNotEmpty({ message: 'يُرجى كتابة سبب التأخير' })
  // Below three characters it is a keystroke to dismiss the dialog, not a
  // reason.
  @MinLength(3, { message: 'يُرجى كتابة سبب التأخير' })
  @MaxLength(500, { message: 'سبب التأخير طويل جدًا' })
  reason: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class ReviewStaffLateReasonDto {
  @ApiProperty({ enum: STAFF_LATE_REASON_VERDICTS })
  @IsIn(STAFF_LATE_REASON_VERDICTS as unknown as string[], {
    message: 'القرار يجب أن يكون accepted أو rejected',
  })
  verdict: (typeof STAFF_LATE_REASON_VERDICTS)[number];

  /**
   * Required for a refusal. Refusing an explanation without saying why leaves
   * a mark on somebody's record and nothing for them to answer.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListStaffLateReasonsDto {
  /**
   * `missing` is the fourth state and the reason this filter exists: a
   * lateness nobody has explained matches none of the three verdicts, so
   * without it the ones needing a nudge are the ones no list can show.
   */
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
  staffId?: string;
}
