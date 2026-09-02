import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WEEKDAYS } from '../schemas/teacher-constraint.schema';

export class UnavailableBlockDto {
  @ApiProperty({ enum: WEEKDAYS })
  @IsIn(WEEKDAYS as unknown as string[], {
    message: 'day يجب أن يكون أحد أيام الأسبوع بالإنجليزية بحروف صغيرة',
  })
  day: string;

  @ApiPropertyOptional({
    description: 'Periods barred on that day. Omit or leave empty for the whole day.',
    type: [Number],
    example: [6, 7],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(20, { each: true })
  slots?: number[];
}

export class SetTeacherConstraintDto {
  @ApiProperty()
  @IsMongoId()
  teacherId: string;

  @ApiProperty({ description: 'Constraints are per term — they do not outlive it.' })
  @IsMongoId()
  termId: string;

  @ApiProperty({
    description: 'Send the whole set; it replaces what is stored. An empty array clears it.',
    type: [UnavailableBlockDto],
  })
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => UnavailableBlockDto)
  unavailable: UnavailableBlockDto[];

  @ApiPropertyOptional({ description: 'Why — for whoever reads the timetable later.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
