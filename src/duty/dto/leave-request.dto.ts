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
  Min, IsNotEmpty, IsIn, ValidateIf } from 'class-validator';
import { LEAVE_KINDS, LEAVE_STATUSES, LeaveKind, LeaveStatus } from '../schemas/leave-request.schema';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateLeaveRequestDto {
  @ApiProperty({ description: 'The day, YYYY-MM-DD', example: '2026-09-02' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date لازم يكون بصيغة YYYY-MM-DD' })
  date: string;

  @ApiPropertyOptional({
    enum: LEAVE_KINDS,
    default: 'early_leave',
    description: "'early_leave' (استئذان) or 'full_day' (planned absence: «غياب مسبق»).",
  })
  @IsOptional()
  @IsIn(LEAVE_KINDS, { message: `kind لازم يكون واحد من: ${LEAVE_KINDS.join(', ')}` })
  kind?: LeaveKind;

  @ApiPropertyOptional({ description: 'Departure time, HH:mm. Required for early_leave; not used for full_day.', example: '11:30' })
  @ValidateIf((o) => (o.kind ?? 'early_leave') === 'early_leave')
  @IsString()
  @Matches(HHMM, { message: 'leaveAt لازم يكون بصيغة HH:mm' })
  leaveAt?: string;

  @ApiPropertyOptional({ description: 'full_day only: the last day, YYYY-MM-DD (default: date). At most 30 days.', example: '2026-12-03' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo لازم يكون بصيغة YYYY-MM-DD' })
  dateTo?: string;

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

  @ApiProperty({ example: 'ظرف عائلي' })
  // Required (29 Oct): the school decides on the reason, and a request without
  // one only comes back as a question.
  // A missing value fails all three, and any of them may be the message shown,
  // so each one reads correctly on its own.
  @IsString({ message: 'سبب الاستئذان مطلوب' })
  @IsNotEmpty({ message: 'سبب الاستئذان مطلوب' })
  @MaxLength(500, { message: 'سبب الاستئذان مطلوب، بحد أقصى 500 حرف' })
  reason: string;

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
