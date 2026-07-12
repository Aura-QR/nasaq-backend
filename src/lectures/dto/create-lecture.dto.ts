import {
  IsNotEmpty,
  IsMongoId,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsString,
  IsOptional,
  IsBoolean
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '../enums/day-of-week.enum';

export class CreateLectureDto {
  @ApiProperty({
    description: 'ID of the class this lecture belongs to'
  })
  @IsNotEmpty()
  @IsMongoId()
  classId: string;

  @ApiProperty({
    description: 'ID of the subject being taught'
  })
  @IsNotEmpty()
  @IsMongoId()
  subjectId: string;

  @ApiProperty({
    description: 'ID of the teacher teaching this lecture'
  })
  @IsNotEmpty()
  @IsMongoId()
  teacherId: string;

  @ApiProperty({
    description: 'Day of the week for this lecture',
    enum: DayOfWeek,
    example: DayOfWeek.MONDAY
  })
  @IsNotEmpty()
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @ApiProperty({
    description: 'Time slot number exp:  (1 = first period, 2 = second period)',
    minimum: 1,
    maximum: 10,
    example: 1
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(10)
  slot: number;
}
