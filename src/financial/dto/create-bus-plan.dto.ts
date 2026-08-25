import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const BUS_SERVICE_TYPES = ['pickup', 'dropoff', 'both'] as const;

export class CreateBusPlanDto {
  @ApiProperty({ example: 'Bus VIP - Round Trip' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: BUS_SERVICE_TYPES, description: 'Bus service type: pickup only, dropoff only, or both.' })
  @IsIn(BUS_SERVICE_TYPES)
  serviceType: (typeof BUS_SERVICE_TYPES)[number];

  @ApiProperty({ description: 'Annual bus fee' })
  @IsNumber()
  @Min(0)
  fee: number;

  @ApiProperty({ required: false, description: 'Installment plan ID. Omit for single full payment.' })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;
}
