import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateGradeLevelDto {
  @ApiProperty({ description: 'ID of the stage' })
  @IsMongoId()
  @IsNotEmpty()
  stageId: string;

  @ApiProperty({ description: 'Name of the grade level (e.g. Grade 1)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Order of the grade level across all stages for promotion logic', minimum: 1 })
  @IsNumber()
  @Min(1)
  order: number;
}
