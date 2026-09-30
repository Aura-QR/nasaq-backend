import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStageDto {
  @ApiProperty({ description: 'Name of the stage (e.g. Elementary, Middle, High)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Display order of the stage', minimum: 1 })
  @IsNumber()
  @Min(1)
  order: number;

  // ───────────────────────────── the stage's own day, all optional
  //
  // Omit them and the stage follows the school, which is what every stage
  // does today. null is accepted as well as omission, so a school can clear
  // a value it set earlier and go back to following the school.

  @ApiPropertyOptional({
    description: 'حصص يوم هذه المرحلة. اتركه فارغًا لاتّباع إعداد المدرسة.',
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(20)
  periodsPerDay?: number | null;

  @ApiPropertyOptional({ description: 'بداية يوم المرحلة HH:mm', example: '07:00' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, { message: 'startTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  startTime?: string | null;

  @ApiPropertyOptional({ description: 'نهاية يوم المرحلة HH:mm', example: '11:30' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, { message: 'endTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  endTime?: string | null;

  @ApiPropertyOptional({
    description: 'طول الحصة بالدقائق — ٣٠ للروضة، ٤٥ للابتدائية.',
    minimum: 5,
    maximum: 120,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(5)
  @Max(120)
  periodMinutes?: number | null;
}
