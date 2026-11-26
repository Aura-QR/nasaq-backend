import { IsEnum, IsArray, IsString, IsMongoId, ValidateNested, IsDate, IsInt, Min, Max, IsNumber, IsOptional, IsIn, MaxLength, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamType } from '../enums/exam-type.enum';

/**
 * One question. The per-type rules (options, answer key, model answer) are
 * checked in the service by question-rules.util, where the messages name
 * the question; these only check the shapes.
 */
export class QuestionDto {
  @IsOptional()
  @IsIn(['mcq', 'true_false', 'essay'], { message: 'نوع السؤال غير صالح' })
  @ApiPropertyOptional({
    description: "Question type. Default 'mcq'.",
    enum: ['mcq', 'true_false', 'essay'],
  })
  type?: 'mcq' | 'true_false' | 'essay';

  @IsString()
  @ApiProperty({
    description: 'The question text',
    example: 'What is the capital of France?',
  })
  question: string;

  // mcq: two or more. true_false: ignored (set to «صح»/«خطأ»). essay: none.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiPropertyOptional({
    description: 'Answer options (mcq). Ignored for true_false; must be empty for essay.',
    example: ['Paris', 'London', 'Berlin', 'Madrid'],
  })
  options?: string[];

  @ValidateIf((o) => o.correctAnswer !== null && o.correctAnswer !== undefined)
  @IsString()
  @ApiPropertyOptional({
    description: 'mcq: one of the options. true_false: «صح» or «خطأ». essay: null.',
    example: 'Paris',
    nullable: true,
  })
  correctAnswer?: string | null;

  @ValidateIf((o) => o.modelAnswer !== null && o.modelAnswer !== undefined)
  @IsString()
  @MaxLength(2000, { message: 'الإجابة النموذجية لا تتجاوز 2000 حرف' })
  @ApiPropertyOptional({ description: 'Essay only: shown to the teacher while marking', nullable: true })
  modelAnswer?: string | null;

  @ValidateIf((o) => o.marks !== null && o.marks !== undefined)
  @IsNumber({}, { message: 'درجة السؤال يجب أن تكون رقمًا' })
  @Min(0.25, { message: 'درجة السؤال لا تقل عن 0.25' })
  @ApiPropertyOptional({
    description: 'The question\'s weight, a multiple of 0.25. Set on every question or on none (equal share).',
    example: 2,
    nullable: true,
  })
  marks?: number | null;
}

export class CreateExamDto {
  @IsMongoId()
  @ApiProperty({
    description: 'The ID of the SubjectOffering for this exam',
  })
  subjectOfferingId: string;

  @IsArray()
  @IsMongoId({ each: true })
  @ApiProperty({
    description: 'Array of class IDs that will take this exam',
  })
  classIds: string[];

  /**
   * Ministry grading template only: what the exam is out of (default 40 for
   * a final, 10 otherwise). Under «معايير الدرجات» it is derived and ignored.
   */
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({ description: 'Ministry template: the exam is out of this', example: 10 })
  grade?: number;

  @IsEnum(ExamType)
  @ApiProperty({
    description: 'The type of exam (final, assignment, activity, or quiz).',
    enum: ExamType,
    example: ExamType.FINAL,
  })
  examType: ExamType;

  @Transform(({ value }) => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  })
  @IsDate()
  @ApiProperty({ description: 'Exam start date (YYYY-MM-DD)', example: '2025-06-01' })
  startDate: Date;

  @Transform(({ value }) => {
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d;
  })
  @IsDate()
  @ApiProperty({ description: 'Exam end date (YYYY-MM-DD)', example: '2025-06-01' })
  endDate: Date;

  @IsInt()
  @Min(1)
  @ApiProperty({ description: 'Exam duration in minutes', example: 120 })
  duration: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  @ApiProperty({
    description: 'Array of questions for this exam',
    type: [QuestionDto],
  })
  questions: QuestionDto[];
}