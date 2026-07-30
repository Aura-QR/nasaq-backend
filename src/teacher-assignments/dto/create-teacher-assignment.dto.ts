import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class CreateTeacherAssignmentDto {
  @ApiProperty({ description: 'ID of the Teacher' })
  @IsMongoId()
  @IsNotEmpty()
  teacherId: string;

  @ApiProperty({ description: 'ID of the SubjectOffering' })
  @IsMongoId()
  @IsNotEmpty()
  subjectOfferingId: string;
}
