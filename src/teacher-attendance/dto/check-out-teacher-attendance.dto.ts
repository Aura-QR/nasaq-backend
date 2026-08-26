import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class CheckOutTeacherAttendanceDto {
  @ApiProperty({ description: 'Latitude coordinate of teacher location', example: 24.7136 })
  @IsNumber()
  lat: number;

  @ApiProperty({ description: 'Longitude coordinate of teacher location', example: 46.6753 })
  @IsNumber()
  lng: number;

  @ApiProperty({ description: 'Flag indicating whether client suspects mock location', default: false, required: false })
  @IsOptional()
  @IsBoolean()
  mockLocationSuspected?: boolean;
}
