import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** «حضوري»: both ends optional — the current term up to today by default. */
export class MyAttendanceStatsDto {
  @ApiPropertyOptional({ description: 'Start of the period (inclusive), YYYY-MM-DD' })
  @IsDateString({}, { message: 'تاريخ البداية غير صالح' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End of the period (inclusive), YYYY-MM-DD' })
  @IsDateString({}, { message: 'تاريخ النهاية غير صالح' })
  @IsOptional()
  dateTo?: string;
}
