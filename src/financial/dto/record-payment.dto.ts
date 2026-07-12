import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RecordPaymentDto {
  @ApiProperty({ example: 1, description: 'Installment number to mark as paid (1-based)' })
  @IsInt()
  @Min(1)
  installmentNumber: number;

  @ApiProperty({ description: 'Amount received (must equal the installment amount)' })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ example: '2025-09-15', description: 'Date the payment was received at school' })
  @IsDateString()
  paidAt: string;

  @ApiProperty({ required: false, description: 'Optional admin notes (e.g. receipt number)' })
  @IsString()
  @IsOptional()
  notes?: string;
}
