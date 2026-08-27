import { IsOptional, IsMongoId, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePreparationDto {
  @ApiPropertyOptional({
    description: 'Lecture ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId()
  lecture?: string;

  @ApiPropertyOptional({
    description: 'Lesson title, free text.',
    example: 'حل المعادلات من الدرجة الأولى',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lessonTitle?: string;

  @ApiPropertyOptional({
    description:
      'Which week this preparation is for (YYYY-MM-DD, any day inside it).',
    example: '2026-08-22',
  })
  @IsOptional()
  @IsString()
  weekOf?: string;
}
