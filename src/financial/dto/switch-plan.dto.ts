import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class SwitchPlanDto {
  @ApiProperty({ description: 'Installment Plan ID (Mongo ObjectId)', required: false })
  @IsMongoId()
  @IsOptional()
  installmentPlanId?: string;

  @ApiProperty({ description: 'Academic Year ID (Mongo ObjectId)', required: false })
  @IsMongoId()
  @IsOptional()
  academicYearId?: string;
}
