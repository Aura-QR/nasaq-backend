import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const BUS_SERVICE_TYPES = ['pickup', 'dropoff', 'both'] as const;

export class UpdateBusPlanDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, enum: BUS_SERVICE_TYPES })
  @IsIn(BUS_SERVICE_TYPES)
  @IsOptional()
  serviceType?: (typeof BUS_SERVICE_TYPES)[number];

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  fee?: number;

  @ApiProperty({ required: false, description: 'Installment plan ID. Omit for single full payment.' })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
