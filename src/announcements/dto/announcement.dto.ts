import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_TYPES,
  AnnouncementAudience,
  AnnouncementType,
} from '../schemas/announcement.schema';

export const ANNOUNCEMENT_STATUSES = ['live', 'scheduled', 'expired', 'paused'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/**
 * A name on the roll. Pick the student (`studentId`) and the server fills in
 * the name and current class; or type a name. Anything typed wins over what the
 * record says, so «أحمد محمد» can stand in for a four-part name.
 */
export class HonorRollEntryDto {
  @IsOptional()
  @IsMongoId({ message: 'معرّف الطالب غير صالح' })
  @ApiPropertyOptional({ description: 'The student; name and class are filled from the record' })
  studentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({ example: 'أحمد محمد العتيبي' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @ApiPropertyOptional({ example: '3/2' })
  className?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({ example: 'الأول على الصف' })
  note?: string;
}

/** The clip lives on YouTube (or any https host); the slide only links to it. */
export class AnnouncementVideoDto {
  @IsString()
  @IsNotEmpty({ message: 'رابط الفيديو مطلوب' })
  @MaxLength(500)
  @ApiProperty({ description: 'An https URL; a YouTube link is recognised', example: 'https://youtu.be/dQw4w9WgXcQ' })
  url: string;
}

export class AnnouncementCtaDto {
  @IsString()
  @IsNotEmpty({ message: 'اكتب نص الزر' })
  @MaxLength(30)
  @ApiProperty({ example: 'سجّل الآن' })
  label: string;

  @IsString()
  @IsNotEmpty({ message: 'رابط الزر مطلوب' })
  @MaxLength(500)
  @ApiProperty({ description: 'An https URL or an in-app path starting with /', example: '/student/library' })
  url: string;
}

export class CreateAnnouncementDto {
  @IsIn(ANNOUNCEMENT_TYPES as unknown as string[], { message: 'نوع الإعلان يجب أن يكون honor_roll أو program أو video' })
  @ApiProperty({ enum: ANNOUNCEMENT_TYPES })
  type: AnnouncementType;

  @IsString()
  @IsNotEmpty({ message: 'اكتب عنوان الإعلان' })
  @MaxLength(120)
  @ApiProperty({ example: 'الطلاب المتميزون لشهر أكتوبر' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  @ApiPropertyOptional({ nullable: true })
  body?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @ApiPropertyOptional({ nullable: true, description: 'The url returned by POST /announcements/uploads' })
  imageUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60, { message: 'لوحة التميز تتسع لستين اسمًا على الأكثر' })
  @ValidateNested({ each: true })
  @Type(() => HonorRollEntryDto)
  @ApiPropertyOptional({ type: [HonorRollEntryDto], description: 'honor_roll only' })
  students?: HonorRollEntryDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementVideoDto)
  @ApiPropertyOptional({ type: AnnouncementVideoDto, nullable: true, description: 'video only' })
  video?: AnnouncementVideoDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementCtaDto)
  @ApiPropertyOptional({ type: AnnouncementCtaDto, nullable: true, description: 'program only' })
  cta?: AnnouncementCtaDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر فئة واحدة على الأقل تظهر لها الإعلان' })
  @ArrayUnique()
  @IsIn(ANNOUNCEMENT_AUDIENCES as unknown as string[], { each: true, message: 'الفئات: STUDENT و TEACHER و ADMIN' })
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_AUDIENCES, isArray: true, description: 'Default: everyone' })
  audiences?: AnnouncementAudience[];

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'تاريخ البداية غير صالح' })
  @ApiPropertyOptional({
    example: '2026-10-18',
    description: 'YYYY-MM-DD (from the start of that day, Riyadh) or a full ISO timestamp. Default: now.',
  })
  startsAt?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'تاريخ النهاية غير صالح' })
  @ApiPropertyOptional({
    example: '2026-10-31',
    nullable: true,
    description: 'YYYY-MM-DD (to the end of that day, Riyadh) or a full ISO timestamp. null: no end.',
  })
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ default: true })
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ description: 'Lowest first. Default: after every existing slide.' })
  order?: number;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(120)
  @ApiPropertyOptional({ nullable: true, description: 'Seconds on screen; null leaves it to the client' })
  durationSeconds?: number | null;
}

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}

export class SetAnnouncementStatusDto {
  @IsBoolean({ message: 'isActive يجب أن تكون true أو false' })
  @ApiProperty({ example: false })
  isActive: boolean;
}

export class ReorderAnnouncementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique({ message: 'تكرر إعلان في الترتيب' })
  @IsMongoId({ each: true, message: 'معرّف إعلان غير صالح' })
  @ApiProperty({ type: [String], description: 'Slides in their new order. Any not listed keep their order after these.' })
  ids: string[];
}

export class ListAnnouncementsQueryDto {
  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES as unknown as string[])
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_STATUSES })
  status?: AnnouncementStatus;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES as unknown as string[])
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_TYPES })
  type?: AnnouncementType;
}
