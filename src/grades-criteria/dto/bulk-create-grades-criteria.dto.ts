import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';
import { ApiProperty, OmitType } from '@nestjs/swagger';
import { CreateGradesCriteriaDto } from './create-grades-criteria.dto';

export class BulkCreateGradesCriteriaDto extends OmitType(CreateGradesCriteriaDto, [
  'subjectOfferingId',
  'subjectId',
  'academicYearId',
  'gradeLevelId',
  'termId',
] as const) {
  @IsArray()
  @ArrayNotEmpty({ message: 'اختر مادة واحدة على الأقل' })
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true, message: 'عرض المادة غير صالح' })
  @ApiProperty({ description: 'The subject offerings that receive this distribution', type: [String] })
  subjectOfferingIds: string[];
}
