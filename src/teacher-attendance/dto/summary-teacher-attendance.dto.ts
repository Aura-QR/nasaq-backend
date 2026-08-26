import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

export class SummaryTeacherAttendanceDto {
  @ApiPropertyOptional({ description: 'Limit the summary to one teacher' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  // Required on purpose: an unbounded summary aggregates every record the
  // school has ever written and answers no question anyone actually asked.
  @ApiProperty({ description: 'Start of the period (inclusive), YYYY-MM-DD' })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ description: 'End of the period (inclusive), YYYY-MM-DD' })
  @IsDateString()
  dateTo: string;
}
