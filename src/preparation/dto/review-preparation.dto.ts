import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REVIEW_STATUSES, ReviewStatus } from '../schemas/preparation.schema';

export class ReviewPreparationDto {
  @ApiProperty({
    description: 'Review outcome',
    enum: REVIEW_STATUSES,
    example: 'approved',
  })
  @IsEnum(REVIEW_STATUSES, {
    message: `reviewStatus لازم يكون واحد من: ${REVIEW_STATUSES.join(', ')}`,
  })
  reviewStatus: ReviewStatus;

  @ApiPropertyOptional({
    description:
      'Why it needs revision — the teacher sees this, so it saves a phone call.',
    example: 'الأهداف ناقصة',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
