import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { JobTitle, JobTitleSchema } from './job-titles/job-title.schema';
import { JobTitlesController } from './job-titles/job-titles.controller';
import { JobTitlesService } from './job-titles/job-titles.service';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Permission.name, schema: PermissionSchema },
      { name: JobTitle.name, schema: JobTitleSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
  ],
  controllers: [PermissionsController, JobTitlesController],
  providers: [PermissionsService, JobTitlesService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
