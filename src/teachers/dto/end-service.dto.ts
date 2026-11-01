import { IsMongoId, IsOptional } from 'class-validator';

export class EndServiceDto {
  /**
   * Who takes over the leaving teacher's lectures. Left out, every lecture
   * stays in the timetable without a teacher, to be filled later.
   */
  @IsOptional()
  @IsMongoId({ message: 'المعلم البديل غير صالح' })
  replacementTeacherId?: string;
}
