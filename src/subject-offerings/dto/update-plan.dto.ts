import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SLOT_PREFERENCES } from '../schemas/subject-offering.schema';

export class PlanEntryDto {
  @ApiProperty({ description: 'Subject offering to set the period count on' })
  @IsMongoId()
  subjectOfferingId: string;

  @ApiProperty({ description: 'Periods a week', example: 6 })
  @IsInt()
  @Min(0)
  @Max(20)
  periodsPerWeek: number;

  /**
   * Where in the day this subject would rather sit.
   *
   * The generator has weighed this since it was written, but nothing could
   * ever set it, so every subject in every school ran as 'any' — and a
   * timetable that puts art first and Arabic last is correct and useless.
   *
   * Optional, so a client that does not send it leaves the stored value
   * alone rather than quietly resetting a preference somebody set.
   */
  @ApiPropertyOptional({
    description:
      "early pulls the subject toward the start of the day (three times as " +
      'hard as the default drift), late pushes it to the end, any is neutral.',
    enum: SLOT_PREFERENCES,
  })
  @IsOptional()
  @IsIn(SLOT_PREFERENCES)
  slotPreference?: (typeof SLOT_PREFERENCES)[number];
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
