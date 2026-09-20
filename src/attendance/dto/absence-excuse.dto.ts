import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The family's account of an absence.
 *
 * `attendanceId` rather than a date: a family may answer days later, and
 * picking the record explicitly is how they answer the right one. The server
 * still checks the record belongs to them.
 */
export class SubmitAbsenceExcuseDto {
  @ApiProperty({ description: 'The absence being explained' })
  @IsMongoId()
  attendanceId: string;

  @ApiProperty({ example: 'وعكة صحية، ومرفق التقرير الطبي' })
  @IsString()
  @MinLength(3, { message: 'اكتب سبب الغياب' })
  @MaxLength(1000)
  reason: string;

  /**
   * A path under /uploads returned by the upload endpoint.
   *
   * Optional because a cold is not a hospital visit, and a school that
   * demanded a document for every sniffle would simply stop being answered.
   */
  @ApiPropertyOptional({ description: 'مسار المرفق كما أعاده رفع الملف' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachment?: string;
}

export const EXCUSE_VERDICTS = ['accepted', 'rejected'] as const;

/** The school's verdict, and why. */
export class ReviewAbsenceExcuseDto {
  @ApiProperty({ enum: EXCUSE_VERDICTS })
  @IsIn(EXCUSE_VERDICTS as unknown as string[], {
    message: 'القرار يجب أن يكون accepted أو rejected',
  })
  verdict: (typeof EXCUSE_VERDICTS)[number];

  /**
   * Required for a refusal, optional for an acceptance.
   *
   * A rejection with no reason is the school telling a family its explanation
   * was not good enough and declining to say why, which is how a form becomes
   * a grievance.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Filters for the manager's queue. */
export class ListAbsenceExcusesDto {
  @ApiPropertyOptional({ enum: ['pending', 'accepted', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  classId?: string;
}
