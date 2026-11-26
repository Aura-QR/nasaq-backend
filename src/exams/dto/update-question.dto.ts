import { IsString, IsArray, IsOptional, IsIn, IsNumber, Min, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Any of a question's fields. The result is checked as a whole against its
 * type (question-rules.util), so changing `type` alone is refused unless the
 * rest fits the new type.
 */
export class UpdateQuestionDto {
  @IsOptional()
  @IsIn(['mcq', 'true_false', 'essay'], { message: 'نوع السؤال غير صالح' })
  @ApiProperty({ enum: ['mcq', 'true_false', 'essay'], required: false })
  type?: 'mcq' | 'true_false' | 'essay';

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'The question text',
    example: 'What is the capital of Spain?',
    required: false,
  })
  question?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    description: 'Array of possible answer options',
    example: ['Madrid', 'Barcelona', 'Valencia', 'Seville'],
    required: false,
  })
  options?: string[];

  @ValidateIf((o) => o.correctAnswer !== null && o.correctAnswer !== undefined)
  @IsString()
  @ApiProperty({
    description: 'The correct answer (must match one of the options)',
    example: 'Madrid',
    required: false,
  })
  correctAnswer?: string | null;

  @ValidateIf((o) => o.modelAnswer !== null && o.modelAnswer !== undefined)
  @IsString()
  @MaxLength(2000, { message: 'الإجابة النموذجية لا تتجاوز 2000 حرف' })
  @ApiProperty({ description: 'Essay only: the model answer', required: false, nullable: true })
  modelAnswer?: string | null;

  @ValidateIf((o) => o.marks !== null && o.marks !== undefined)
  @IsNumber({}, { message: 'درجة السؤال يجب أن تكون رقمًا' })
  @Min(0.25, { message: 'درجة السؤال لا تقل عن 0.25' })
  @ApiProperty({ description: 'The question\'s weight, a multiple of 0.25', required: false, nullable: true })
  marks?: number | null;
}
