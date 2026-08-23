import { IsArray, IsEmail, IsNotEmpty, IsString, Length, IsOptional, IsIn } from 'class-validator';

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

  /*
   * IGNORED for MANAGER. A manager's rights come from the school's MANAGER row
   * (see default-permissions.ts), the same way a teacher's and a student's do —
   * one definition per school instead of a different hand-written array on
   * every account.
   *
   * Optional now so the caller does not have to invent a list. Still accepted
   * so an existing client sending one does not get a 400 from
   * forbidNonWhitelisted.
   *
   * To change what managers can do: PATCH /permissions/MANAGER.
   */
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsIn(['MANAGER', 'SUPERVISOR'])
  role?: 'MANAGER' | 'SUPERVISOR';
}

export class UpdateManagerPermissionsDto {
  /** Optional and ignored — see the note on CreateManagerDto.permissions. */
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  permissions?: string[];
}
