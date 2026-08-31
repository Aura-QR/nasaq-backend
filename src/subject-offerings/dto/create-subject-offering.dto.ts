import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';

export class CreateSubjectOfferingDto {
  @ApiProperty({ description: 'ID of the Subject concept' })
  @IsMongoId()
  @IsNotEmpty()
  subjectId: string;

  @ApiProperty({ description: 'ID of the GradeLevel' })
  @IsMongoId()
  @IsNotEmpty()
  gradeLevelId: string;

  @ApiProperty({ description: 'ID of the Term' })
  @IsMongoId()
  @IsNotEmpty()
  termId: string;

  @ApiPropertyOptional({
    description:
      'Periods a week for this subject, in every class of this grade. ' +
      '0 (the default) means unplanned and is skipped by the generator.',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  periodsPerWeek?: number;
}
