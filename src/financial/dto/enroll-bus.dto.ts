import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

const BUS_SERVICE_TYPES = ['pickup', 'dropoff', 'both'] as const;

export class EnrollBusDto {
  @ApiProperty({ description: 'Annual bus fee in EGP' })
  @IsNumber()
  @Min(0)
  fee: number;

  @ApiProperty({
    enum: BUS_SERVICE_TYPES,
    description: 'Bus service type: pickup only, dropoff only, or both.',
  })
  @IsIn(BUS_SERVICE_TYPES)
  serviceType: (typeof BUS_SERVICE_TYPES)[number];

  @ApiProperty({ required: false, description: 'Installment plan ID for bus payments. Omit for single full payment.' })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;
}
