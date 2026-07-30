import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateTermDto {
  @ApiProperty({ description: 'ID of the academic year' })
  @IsMongoId()
  @IsNotEmpty()
  academicYearId: string;

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
