import {
  IsNotEmpty,
  IsMongoId,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '../enums/day-of-week.enum';

export class CreateLectureDto {
  @ApiProperty({ description: 'ID of the class this lecture belongs to' })
  @IsNotEmpty()
  @IsMongoId()
  classId: string;

  @ApiProperty({ description: 'ID of the SubjectOffering instance' })
  @IsNotEmpty()
  @IsMongoId()
  subjectOfferingId: string;

  @ApiProperty({ description: 'ID of the Term' })
  @IsNotEmpty()
  @IsMongoId()
  termId: string;

  @ApiPropertyOptional({ description: 'ID of the teacher teaching this lecture (optional)' })
  @IsOptional()
  @IsMongoId()
  teacherId?: string;

  @ApiProperty({ description: 'Day of the week', enum: DayOfWeek })
  @IsNotEmpty()
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @ApiProperty({ description: 'Time slot number (1-10)', minimum: 1, maximum: 10 })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(10)
  slot: number;
}
