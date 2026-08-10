import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RefundAdditionalFeeDto {
  @ApiProperty({ description: 'Refund amount in EGP' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Refund date (ISO string)', required: false })
  @IsDateString()
  @IsOptional()
  refundedAt?: string;

  @ApiProperty({ description: 'Reason for refund/correction', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: 'Academic Year ID (optional)', required: false })
  @IsString()
  @IsOptional()
  academicYearId?: string;
}
