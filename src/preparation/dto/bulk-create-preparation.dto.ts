import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * multipart/form-data has no notion of an array, so clients send `lectureIds`
 * repeated, as `lectureIds[]`, or as one comma-separated string depending on
 * their HTTP layer. Accept all three rather than make each client guess.
 */
const toIdArray = ({ value }: { value: unknown }): string[] => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

export class BulkCreatePreparationDto {
  @ApiProperty({
    description:
      'Lectures to file this preparation against — one preparation is created ' +
      'per lecture. Repeated field, `lectureIds[]`, or comma-separated.',
    type: [String],
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
  })
  @Transform(toIdArray)
  @IsArray()
  @ArrayMinSize(1, { message: 'لازم تبعت حصة واحدة على الأقل' })
  @ArrayMaxSize(40, { message: 'أقصى عدد حصص في المرة الواحدة ٤٠' })
  @IsMongoId({ each: true })
  lectureIds: string[];

  @ApiPropertyOptional({
    description: 'Lesson title, free text — applied to every lecture in the batch.',
    example: 'حل المعادلات من الدرجة الأولى',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  lessonTitle?: string;

  @ApiPropertyOptional({
    description:
      'Any date inside the target week (YYYY-MM-DD). Defaults to the current week.',
    example: '2026-11-14',
  })
  @IsOptional()
  @IsString()
  weekOf?: string;
}
