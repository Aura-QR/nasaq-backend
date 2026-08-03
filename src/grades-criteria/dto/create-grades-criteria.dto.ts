import {
  IsNotEmpty,
  IsNumber,
  IsMongoId,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGradesCriteriaDto {
  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'The SubjectOffering ID for the grading schema' })
  subjectOfferingId: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(100)
  @ApiProperty({ description: 'Final exam weight/percentage', example: 40 })
  final: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(100)
  @ApiProperty({ description: 'Assignments weight/percentage', example: 15 })
  assignments: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @ApiProperty({ description: 'Number of assignments', example: 3 })
  assignmentsCount: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(100)
  @ApiProperty({ description: 'Activities weight/percentage', example: 15 })
  activities: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(100)
  @ApiProperty({ description: 'Projects weight/percentage', example: 10 })
  projects: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @ApiProperty({ description: 'Number of projects', example: 2 })
  projectsCount: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @Max(100)
  @ApiProperty({ description: 'Quizzes weight/percentage', example: 10 })
  quizzes: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @ApiProperty({ description: 'Number of quizzes', example: 2 })
  quizzesCount: number;
}
