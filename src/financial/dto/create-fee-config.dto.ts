import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateFeeConfigDto {
  @ApiProperty({ description: 'Academic year / grade level (e.g. "Grade 1"). Must match Class.academicYear.' })
  @IsString()
  @IsNotEmpty()
  academicYear: string;

  @ApiProperty({ description: 'Annual tuition fee in EGP' })
  @IsNumber()
  @Min(0)
  tuitionFee: number;
}
