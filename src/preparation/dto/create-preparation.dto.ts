import {
  IsNotEmpty,
  IsString,
  IsMongoId,
  IsArray,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePreparationDto {
  @ApiProperty({
    description: 'Lecture ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsMongoId()
  lecture: string;

  @ApiPropertyOptional({
    description:
      'Lesson title, free text — whatever the teacher wrote on the sheet. ' +
      'There is no curriculum in the system to pick from.',
    example: 'حل المعادلات من الدرجة الأولى',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lessonTitle?: string;

  @ApiPropertyOptional({
    description:
      'Which week this preparation is for (YYYY-MM-DD, any day inside the ' +
      'week). Normalised server-side to the Saturday that opens it. ' +
      'Defaults to the current week. The calendar day is derived from the ' +
      "lecture's dayOfWeek — the teacher never types a date.",
    example: '2026-08-22',
  })
  @IsOptional()
  @IsString()
  weekOf?: string;

  @ApiProperty({
    description: 'File paths',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];
}
