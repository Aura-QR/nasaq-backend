import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateQuestionDto {
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

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'The correct answer (must match one of the options)',
    example: 'Madrid',
    required: false,
  })
  correctAnswer?: string;
}
