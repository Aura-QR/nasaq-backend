import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterSchoolDto {
  // School details
  @IsString()
  @IsNotEmpty()
  schoolName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'الرابط التعريفي للمدرسة يجب أن يحتوي على حروف صغيرة وأرقام وشرطات فقط' })
  slug: string;

  @IsEmail()
  @IsNotEmpty()
  schoolEmail: string;

  @IsString()
  @IsOptional()
  phone?: string;

  // Owner Admin details
  @IsString()
  @IsNotEmpty()
  ownerName: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 20)
  ownerUsername: string;

  @IsEmail()
  @IsNotEmpty()
  ownerEmail: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 100)
  ownerPassword: string;
}
