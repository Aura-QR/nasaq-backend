import { IsArray, IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateManagerDto {
  @IsString()
  @IsNotEmpty()
  @Length(4, 20)
  username: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 100)
  password: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateManagerPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}
