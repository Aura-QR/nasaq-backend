import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

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
}
