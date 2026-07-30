import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateStageDto {
  @ApiProperty({ description: 'Name of the stage (e.g. Elementary, Middle, High)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Display order of the stage', minimum: 1 })
  @IsNumber()
  @Min(1)
  order: number;
}
