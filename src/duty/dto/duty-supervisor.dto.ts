import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SetDutySupervisorsDto {
  @ApiProperty({ description: 'The day, YYYY-MM-DD', example: '2026-09-02' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date لازم يكون بصيغة YYYY-MM-DD' })
  date: string;

  @ApiProperty({
    description:
      'Supervisors on duty. Replaces the day entirely — an empty array ' +
      'clears it. Most days carry one, some carry two.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsMongoId({ each: true })
  teacherIds: string[];

  @ApiPropertyOptional({ example: 'مناوبة الفسحة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
