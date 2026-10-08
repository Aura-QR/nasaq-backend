import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateSubjectOfferingDto {
  @ApiPropertyOptional({
    description: 'Periods a week for this subject across the grade.',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  periodsPerWeek?: number;

  @ApiPropertyOptional({
    description: "Ministry template: override the subject's assessment type for this grade; null — the subject's",
    enum: ['continuous', 'final_exam'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['continuous', 'final_exam', null])
  assessmentType?: 'continuous' | 'final_exam' | null;
}
