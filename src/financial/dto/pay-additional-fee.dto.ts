import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PayAdditionalFeeDto {
  @ApiProperty({ description: 'Payment amount in EGP' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Payment date (ISO string)' })
  @IsDateString()
  paidAt: string;

  @ApiProperty({ description: 'Payment notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Academic Year ID (optional)', required: false })
  @IsString()
  @IsOptional()
  academicYearId?: string;
}
