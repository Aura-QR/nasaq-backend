import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlanEntryDto {
  @ApiProperty({ description: 'Subject offering to set the period count on' })
  @IsMongoId()
  subjectOfferingId: string;

  @ApiProperty({ description: 'Periods a week', example: 6 })
  @IsInt()
  @Min(0)
  @Max(20)
  periodsPerWeek: number;
}

/**
 * The teaching plan is entered as a grid — one row per subject, one number
 * each — so it is saved as a grid too. Sending 30 separate PATCHes to save one
 * screen would make a partial save the normal outcome.
 */
export class UpdatePlanDto {
  @ApiProperty({ type: [PlanEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PlanEntryDto)
  entries: PlanEntryDto[];
}
