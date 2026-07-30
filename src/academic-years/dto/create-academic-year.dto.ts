import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateAcademicYearDto {
  @ApiProperty({ description: 'Name of the academic year (e.g. 2027/2028)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Start date of the academic year' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date of the academic year' })
  @IsDateString()
  endDate: string;
}
