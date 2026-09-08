import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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

/**
 * multipart has no notion of a nested array either, so `items` arrives as a
 * JSON string from any client sending files alongside it.
 */
const toItems = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    // Let class-validator report it as "not an array" rather than throwing a
    // SyntaxError out of the transform, which surfaces as a 500.
    return value;
  }
};

/** One lecture and the lesson being taught in it. */
export class BulkPreparationItemDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  lectureId: string;

  @ApiPropertyOptional({
    description:
      'A lesson from THIS school\'s curriculum. It must belong to the ' +
      'subject and grade of its own lecture — each item is checked separately.',
    example: '507f1f77bcf86cd799439099',
  })
  @IsOptional()
  @IsMongoId()
  lessonId?: string;
}

export class BulkCreatePreparationDto {
  @ApiProperty({
    description:
      'Lectures to file this preparation against — one preparation is created ' +
      'per lecture. Repeated field, `lectureIds[]`, or comma-separated.',
    type: [String],
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
  })
  @Transform(toIdArray)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40, { message: 'أقصى عدد حصص في المرة الواحدة ٤٠' })
  @IsMongoId({ each: true })
  lectureIds?: string[];

  @ApiPropertyOptional({
    description:
      'One lecture and its own lesson. Use this instead of lectureIds when ' +
      'the lessons differ — a week of maths is six different lessons, not ' +
      'the same one six times.',
    type: [BulkPreparationItemDto],
  })
  @Transform(toItems)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40, { message: 'أقصى عدد حصص في المرة الواحدة ٤٠' })
  @ValidateNested({ each: true })
  @Type(() => BulkPreparationItemDto)
  items?: BulkPreparationItemDto[];

  @ApiPropertyOptional({
    description:
      'Lesson title, free text — applied to every lecture in the batch. ' +
      'Ignored for an item that names a lessonId, whose title comes from the ' +
      'curriculum.',
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
