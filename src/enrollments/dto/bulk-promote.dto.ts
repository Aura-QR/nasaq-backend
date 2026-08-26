import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const EXCLUSION_REASONS = ['graduated', 'transferred', 'withdrawn'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export class SinglePromotionDto {
  @ApiProperty({ description: 'Student ID' })
  @IsMongoId()
  studentId: string;

  @ApiProperty({ description: 'Target Class ID in the new academic year' })
  @IsMongoId()
  targetClassId: string;
}

export class ExcludedStudentDto {
  @ApiProperty({ description: 'Student ID' })
  @IsMongoId()
  studentId: string;

  @ApiProperty({
    enum: EXCLUSION_REASONS,
    description: 'Why this student is not being promoted. Written to their old enrollment.',
  })
  @IsIn(EXCLUSION_REASONS)
  reason: ExclusionReason;
}

export class BulkPromoteDto {
  @ApiProperty({ description: 'Array of student promotion mappings', type: [SinglePromotionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SinglePromotionDto)
  promotions: SinglePromotionDto[];

  /*
   * The year being promoted FROM, so an excluded student's old enrollment can
   * be closed out with their reason.
   *
   * Optional: the mobile client does not send it, and forbidNonWhitelisted
   * means a required field would 400 every call it makes today. When it is
   * absent the service resolves each excluded student's own latest active
   * enrollment outside the target year instead, which is the same document in
   * every real case.
   */
  @ApiPropertyOptional({ description: 'The academic year students are being promoted FROM' })
  @IsMongoId()
  @IsOptional()
  previousAcademicYearId?: string;

  /**
   * Excluded students WITH a reason. Preferred over `excludedStudentIds`:
   * the reason is what gets written to the old enrollment, so the record says
   * whether the student graduated, transferred, or withdrew.
   */
  @ApiPropertyOptional({ type: [ExcludedStudentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExcludedStudentDto)
  excludedStudents?: ExcludedStudentDto[];

  /**
   * DEPRECATED — ids with no reason. Still accepted because the mobile client
   * sends this shape; each id is treated as `withdrawn`, the neutral outcome.
   * Send `excludedStudents` instead so the reason is not guessed.
   */
  @ApiPropertyOptional({ deprecated: true, type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  excludedStudentIds?: string[];
}
