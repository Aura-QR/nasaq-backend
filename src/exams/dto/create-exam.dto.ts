import { IsEnum, IsArray, IsString, IsMongoId, ValidateNested, IsDate, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
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
    description: 'The ID of the subject this exam belongs to',
  })
  subjectId: string;

  @IsMongoId()
  @ApiProperty({
    description: 'The ID of the academic year for this exam',
  })
  academicYearId: string;

  @IsArray()
  @IsMongoId({ each: true })
  @ApiProperty({
    description: 'Array of class IDs that will take this exam',
  })
  classIds: string[];

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