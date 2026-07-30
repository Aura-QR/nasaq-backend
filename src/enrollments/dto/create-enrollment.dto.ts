import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class CreateEnrollmentDto {
  @ApiProperty({ description: 'ID of the student' })
  @IsMongoId()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ description: 'ID of the target class' })
  @IsMongoId()
  @IsNotEmpty()
  classId: string;

  @ApiProperty({ description: 'ID of the academic year' })
  @IsMongoId()
  @IsNotEmpty()
  academicYearId: string;
}
