import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
