import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LEAVE_STATUSES, LeaveStatus } from '../schemas/leave-request.schema';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateLeaveRequestDto {
  @ApiProperty({ description: 'The day, YYYY-MM-DD', example: '2026-09-02' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date لازم يكون بصيغة YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'Departure time, HH:mm', example: '11:30' })
  @IsString()
  @Matches(HHMM, { message: 'leaveAt لازم يكون بصيغة HH:mm' })
  leaveAt: string;

  @ApiPropertyOptional({
    description:
      'First lecture the teacher will miss. More precise than the time, ' +
      'because the school has no per-slot clock times to convert it from.',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  fromSlot?: number;

  @ApiPropertyOptional({ example: 'ظرف عائلي' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'File on behalf of a teacher. Staff only — a teacher always files for ' +
      'themselves and this is ignored for them.',
  })
  @IsOptional()
  @IsMongoId()
  teacherId?: string;
}

export class ReviewLeaveRequestDto {
  @ApiProperty({ enum: LEAVE_STATUSES, example: 'approved' })
  @IsEnum(LEAVE_STATUSES, {
    message: `status لازم يكون واحد من: ${LEAVE_STATUSES.join(', ')}`,
  })
  status: LeaveStatus;

  @ApiPropertyOptional({ example: 'مقبول، والبديل أ. سارة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}
