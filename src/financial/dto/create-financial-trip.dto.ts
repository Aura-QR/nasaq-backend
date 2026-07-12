import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateFinancialTripDto {
  @ApiProperty({ example: 'Science Museum Visit' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Trip fee in EGP' })
  @IsNumber()
  @Min(0)
  fee: number;
}
