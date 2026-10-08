import { IsEnum, IsArray, IsString, IsMongoId, ValidateNested, IsDate, IsInt, Min, Max, IsNumber, IsOptional } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamType } from '../enums/exam-type.enum';

export class QuestionDto {
  @IsString()
  @ApiProperty({
    description: 'The question text',
    example: 'What is the capital of France?',
  })
  question: string;

  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    description: 'Array of possible answer options',
    example: ['Paris', 'London', 'Berlin', 'Madrid'],
  })
  options: string[];

  @IsString()
  @ApiProperty({
    description: 'The correct answer (must match one of the options)',
    example: 'Paris',
  })
  correctAnswer: string;
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