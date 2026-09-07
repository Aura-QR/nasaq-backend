import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { MongoIdPipe } from '../common/pipes/mongo-id.pipe';
import { CurriculumService } from './curriculum.service';
import {
  ImportCurriculumDto,
  CreateCurriculumUnitDto,
  CreateCurriculumLessonDto,
  CreateCurriculumLessonsBulkDto,
  UpdateCurriculumLessonDto,
  UpdateCurriculumUnitDto,
  CurriculumQueryDto,
} from './dto/curriculum.dto';
@Controller('curriculum')
@ApiTags('Curriculum')
// Curriculum objectives are staff content; student preparation reads have their own projection.
@Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.TEACHER)
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}
  @Roles(Role.OWNER, Role.MANAGER)
  @Post('import')
  import(@Body() dto: ImportCurriculumDto) {
    return this.service.import(dto);
  }
  @Get('units')
  units(@Query() query: CurriculumQueryDto) {
    return this.service.listUnits(query);
  }
  @Get('units/:id/lessons')
  lessons(@Param('id', MongoIdPipe) id: string) {
    return this.service.listLessons(id);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Post('units')
  createUnit(@Body() dto: CreateCurriculumUnitDto) {
    return this.service.createUnit(dto);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Patch('units/:id')
  updateUnit(
    @Param('id', MongoIdPipe) id: string,
    @Body() dto: UpdateCurriculumUnitDto,
  ) {
    return this.service.updateUnit(id, dto);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Delete('units/:id')
  deleteUnit(@Param('id', MongoIdPipe) id: string) {
    return this.service.deleteUnit(id);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Post('units/:id/lessons')
  createLesson(
    @Param('id', MongoIdPipe) id: string,
    @Body() dto: CreateCurriculumLessonDto,
  ) {
    return this.service.createLesson(id, dto);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Post('units/:id/lessons-bulk')
  createLessonsBulk(
    @Param('id', MongoIdPipe) id: string,
    @Body() dto: CreateCurriculumLessonsBulkDto,
  ) {
    return this.service.createLessonsBulk(id, dto);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Patch('lessons/:id')
  updateLesson(
    @Param('id', MongoIdPipe) id: string,
    @Body() dto: UpdateCurriculumLessonDto,
  ) {
    return this.service.updateLesson(id, dto);
  }
  @Roles(Role.OWNER, Role.MANAGER)
  @Delete('lessons/:id')
  deleteLesson(@Param('id', MongoIdPipe) id: string) {
    return this.service.deleteLesson(id);
  }
}
