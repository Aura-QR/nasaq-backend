import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateJobTitleDto {
  @ApiProperty({ example: 'المالية' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'اكتب اسم المسمى الوظيفي' })
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ enum: ['finance', 'studentAffairs', 'teacherAffairs', 'academic'] })
  @IsOptional()
  @IsIn(['finance', 'studentAffairs', 'teacherAffairs', 'academic'])
  templateKey?: string;

  /** Keys and values are checked in the service; see normalizeTitlePermissions. */
  @ApiPropertyOptional({ description: 'Record<key, { read, add, edit, delete }>; defaults to the template, or to nothing' })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>;
}

export class UpdateJobTitleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'اكتب اسم المسمى الوظيفي' })
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>;
}

export class AssignJobTitleDto {
  @ApiProperty({ enum: ['admin', 'teacher'], description: 'admin: a MANAGER account; teacher: a teacher promoted to manager' })
  @IsIn(['admin', 'teacher'])
  type: 'admin' | 'teacher';

  @ApiProperty({ nullable: true, description: 'null clears the title — the account falls back to the school MANAGER permissions' })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId({ message: 'معرّف المسمى الوظيفي غير صالح' })
  jobTitleId: string | null;
}
