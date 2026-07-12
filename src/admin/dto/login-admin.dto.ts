import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginAdminDto {
  @IsString()
  @ApiProperty({ description: 'The identifier of the admin' })
  @IsNotEmpty()
  @MinLength(3)
  identifier: string; // Can be username or email

  @IsString()
  @ApiProperty({ description: 'The password of the admin' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}