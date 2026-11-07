import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Any https meeting link: Teams, Zoom, Google Meet. Empty clears it. */
const LINK = /^(https:\/\/\S{8,2000})?$/;

export class CreateRemoteDayDto {
  @ApiProperty({ example: '2026-11-09' })
  @Matches(DAY, { message: 'تاريخ البداية بصيغة YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ required: false, example: '2026-11-10', description: 'Defaults to startDate' })
  @IsOptional()
  @Matches(DAY, { message: 'تاريخ النهاية بصيغة YYYY-MM-DD' })
  endDate?: string;

  @ApiProperty({ required: false, type: [String], description: 'Empty = whole school' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  stageIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class MeetingUrlDto {
  @ApiProperty({ example: 'https://teams.microsoft.com/l/meetup-join/...', description: 'Empty clears it' })
  @IsString()
  @Matches(LINK, { message: 'الرابط يجب أن يبدأ بـ https://' })
  meetingUrl: string;
}

export class LessonLinkDto {
  @ApiProperty({ example: '2026-11-09' })
  @Matches(DAY, { message: 'التاريخ بصيغة YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'Empty removes the lesson link; the teacher link applies again' })
  @IsString()
  @Matches(LINK, { message: 'الرابط يجب أن يبدأ بـ https://' })
  joinUrl: string;
}
