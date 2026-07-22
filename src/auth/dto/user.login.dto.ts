import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @IsString()
  @ApiProperty({ description: 'The identifier of the user (email or username)' })
  @IsNotEmpty()
  @MinLength(3)
  identifier: string;

  @IsString()
  @ApiProperty({ description: 'The password of the user' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @ApiProperty({ description: 'The school slug for login scoping', required: false })
  @IsOptional()
  schoolSlug?: string;

  @IsString()
  @ApiProperty({ description: 'The school ID for login scoping', required: false })
  @IsOptional()
  schoolId?: string;
}