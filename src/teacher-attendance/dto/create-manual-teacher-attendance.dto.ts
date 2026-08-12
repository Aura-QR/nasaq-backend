import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, Matches } from 'class-validator';

export class CreateManualTeacherAttendanceDto {
  @ApiProperty({ description: 'ID of the teacher', example: '60d5ecb8b5c9c22b8c8b4567' })
  @IsMongoId()
  teacherId: string;

  @ApiProperty({ description: 'Calendar date of attendance (YYYY-MM-DD)', example: '2026-09-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in format YYYY-MM-DD (e.g., 2026-09-20)',
  })
  @IsString()
  date: string;

  // Accepts both forms parseCheckInTime() understands: 24h HH:mm, or a full
  // ISO timestamp. Kept permissive on purpose — narrowing it to HH:mm would
  // break any caller already sending ISO.
  @ApiProperty({ description: 'Arrival time (24h HH:mm, or an ISO date string)', example: '07:45' })
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|\d{4}-\d{2}-\d{2}T[\d:.]+Z?)$/, {
    message: 'checkInAt must be 24h HH:mm (e.g., 07:45) or an ISO date string',
  })
  @IsString()
  checkInAt: string;

  @ApiProperty({ description: 'Notes or reason for manual entry', required: false, example: 'الجهاز لا يدعم تحديد الموقع' })
  @IsOptional()
  @IsString()
  notes?: string;
}
