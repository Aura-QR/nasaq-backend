import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../pagination/dto/pagination.dto';

/**
 * Paging plus a search term.
 *
 * `q` has to live on the DTO, not as a loose `@Query('q')` beside it: the
 * global ValidationPipe runs with `forbidNonWhitelisted`, so it rejects the
 * whole request — `property q should not exist` — for any query key the
 * validated class does not declare. The extra parameter never reaches the
 * handler.
 */
export class CatalogQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search the subject name or the course variant',
    example: 'رياضيات',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
