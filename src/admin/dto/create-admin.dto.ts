import { IsString, IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAdminDto {
  @IsString()
  @ApiProperty({ description: 'The username of the admin' })
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @IsEmail()
  @ApiProperty({ description: 'The email of the admin' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @ApiProperty({ description: 'The password of the admin' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}