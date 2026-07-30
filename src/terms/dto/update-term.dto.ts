import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTermDto {
  @ApiProperty({ description: 'Name of the term', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'Order of the term', minimum: 1, required: false })
  @IsNumber()
  @Min(1)
  @IsOptional()
  order?: number;

  @ApiProperty({ description: 'Start date of the term', required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'End date of the term', required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ description: 'Status of the term', enum: ['upcoming', 'active', 'closed'], required: false })
  @IsEnum(['upcoming', 'active', 'closed'])
  @IsOptional()
  status?: string;
}
