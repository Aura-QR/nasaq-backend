import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStaffLeaveRequestDto {
  @ApiProperty({ example: '2026-09-22', description: 'YYYY-MM-DD' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '11:30', description: 'HH:mm, 24-hour' })
  @Matches(TIME_PATTERN, { message: 'وقت الانصراف يجب أن يكون بصيغة HH:mm' })
  leaveAt: string;

  @ApiPropertyOptional({ example: 'موعد طبي' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Filing on behalf of somebody else. A manager may; a supervisor files only
   * for themselves, which is enforced in the service rather than here.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  staffId?: string;
}

export class ReviewStaffLeaveRequestDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'], {
    message: 'القرار يجب أن يكون approved أو rejected',
  })
  status: 'approved' | 'rejected';

  /**
   * Required for a refusal. Refusing without saying why leaves somebody with
   * a decision they cannot plan around.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

export class ListStaffLeaveRequestsDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-22' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  staffId?: string;
}
