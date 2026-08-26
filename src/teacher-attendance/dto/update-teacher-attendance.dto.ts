import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateTeacherAttendanceDto {
  @ApiProperty({ description: 'Updated check-in time (HH:mm format or ISO date string)', required: false })
  @IsOptional()
  @IsString()
  checkInAt?: string;

  @ApiProperty({
    description: 'Check-out time (HH:mm or ISO). For schools that do not use location check-out.',
    required: false,
  })
  @IsOptional()
  @IsString()
  checkOutAt?: string;

  @ApiProperty({ description: 'Updated notes or reason for modification', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
