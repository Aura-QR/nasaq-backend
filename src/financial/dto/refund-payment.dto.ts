import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({ example: 1, description: 'Installment number to refund (1-based)' })
  @IsInt()
  @Min(1)
  installmentNumber: number;

  @ApiProperty({ description: 'Amount to refund (must be <= paidAmount on that installment)' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'Incorrect amount recorded per receipt #4501', description: 'Reason for refund/correction' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({ required: false, example: '2026-09-19', description: 'Date refund was processed' })
  @IsDateString()
  @IsOptional()
  refundedAt?: string;

  @ApiProperty({ required: false, description: 'Academic Year ID (Mongo ObjectId)' })
  @IsString()
  @IsOptional()
  academicYearId?: string;
}
