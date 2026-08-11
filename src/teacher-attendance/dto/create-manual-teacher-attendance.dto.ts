import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateManualTeacherAttendanceDto {
  @ApiProperty({ description: 'ID of the teacher', example: '60d5ecb8b5c9c22b8c8b4567' })
  @IsMongoId()
  teacherId: string;

  @ApiProperty({ description: 'Calendar date of attendance (YYYY-MM-DD)', example: '2026-09-20' })
  @IsString()
  date: string;

  @ApiProperty({ description: 'Arrival time (HH:mm format or ISO date string)', example: '07:45' })
  @IsString()
  checkInAt: string;

  @ApiProperty({ description: 'Notes or reason for manual entry', required: false, example: 'الجهاز لا يدعم تحديد الموقع' })
  @IsOptional()
  @IsString()
  notes?: string;
}
