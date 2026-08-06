import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSchoolSettingsDto {
  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  termsPerYear?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  defaultPassingGrade?: number;
}
