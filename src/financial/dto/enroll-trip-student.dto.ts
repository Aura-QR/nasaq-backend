import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class EnrollTripStudentDto {
  @ApiProperty({ description: 'Student ID to enroll in this trip' })
  @IsMongoId()
  studentId: string;

  @ApiProperty({ required: false, description: 'Optional installment plan override for this student trip' })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;
}
