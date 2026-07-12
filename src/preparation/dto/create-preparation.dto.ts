import { IsNotEmpty, IsString, IsMongoId, IsArray, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePreparationDto {
  @ApiProperty({
    description: 'Lecture ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsMongoId()
  lecture: string;

  @ApiProperty({
    description: 'File paths',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];
}
