import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class SwitchBusPlanDto {
  @ApiProperty({ description: 'New Bus Plan ID' })
  @IsMongoId()
  busPlanId: string;

  @ApiProperty({ required: false, description: 'Academic Year ID (Mongo ObjectId)' })
  @IsString()
  @IsOptional()
  academicYearId?: string;
}
