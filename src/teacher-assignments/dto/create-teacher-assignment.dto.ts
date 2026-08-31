import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateTeacherAssignmentDto {
  @ApiProperty({ description: 'ID of the Teacher' })
  @IsMongoId()
  @IsNotEmpty()
  teacherId: string;

  @ApiProperty({ description: 'ID of the SubjectOffering' })
  @IsMongoId()
  @IsNotEmpty()
  subjectOfferingId: string;

  @ApiPropertyOptional({
    description:
      'Pin this teacher to one class instead of the whole grade. Omit to keep ' +
      'the default meaning — every class in the grade. Only needed when two ' +
      'teachers split a grade between them.',
  })
  @IsOptional()
  @IsMongoId()
  classId?: string;
}
