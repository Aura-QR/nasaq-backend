import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  SetMetadata,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { MongoIdPipe } from '../common/pipes/mongo-id.pipe';
import { PlatformOnly } from '../tenancy/decorators/platform-only.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { SeedCatalogSubjectDto } from './dto/seed-catalog.dto';
export const CATALOG_READ_KEY = 'catalogPlatformRead';
@Controller('catalog')
@ApiTags('Catalog')
export class CatalogController {
  constructor(private readonly service: CatalogService) {}
  @SetMetadata(CATALOG_READ_KEY, true)
  @Get('subjects')
  list(@Query() query: PaginationDto) {
    return this.service.listSubjects(query);
  }
  @SetMetadata(CATALOG_READ_KEY, true)
  @Get('subjects/:id/units')
  units(@Param('id', MongoIdPipe) id: string) {
    return this.service.getUnits(id);
  }
  @PlatformOnly()
  @Roles(Role.SUPER_ADMIN)
  @Post('seed')
  seed(@Body() dto: SeedCatalogSubjectDto) {
    return this.service.seedSubject(dto);
  }
}
