import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateDiscountDto {
  @ApiProperty({ example: 'Siblings Discount' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'Applied to families with more than one student' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 10, description: 'Discount percentage (0-100)' })
  @IsNumber()
  @Min(0)
  percentage: number;
}
