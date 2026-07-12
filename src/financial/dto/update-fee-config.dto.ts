import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateFeeConfigDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  academicYear?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  tuitionFee?: number;
}
