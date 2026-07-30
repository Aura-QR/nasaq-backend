import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TermItemDto {
  @ApiProperty({ description: 'Name of the term' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Order of the term', minimum: 1 })
  @IsNumber()
  @Min(1)
  order: number;

  @ApiProperty({ description: 'Start date of the term' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date of the term' })
  @IsDateString()
  endDate: string;
}

export class CreateTermsBulkDto {
  @ApiProperty({ description: 'Array of terms to create', type: [TermItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermItemDto)
  terms: TermItemDto[];
}
