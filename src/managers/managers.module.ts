import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { JobTitle, JobTitleSchema } from 'src/permissions/job-titles/job-title.schema';
import { ManagersService } from './managers.service';
import { ManagersController } from './managers.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: JobTitle.name, schema: JobTitleSchema },
    ]),
  ],
  controllers: [ManagersController],
  providers: [ManagersService],
  exports: [ManagersService],
})
export class ManagersModule {}
