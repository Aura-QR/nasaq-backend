import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddTripDto {
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

  @ApiProperty({ required: false, description: 'Installment plan ID for trip payments. Omit for single full payment.' })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;
}
