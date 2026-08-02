import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Project, ProjectSchema } from './schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from './schemas/project-submission.schema';
import {
  GradesCriteria,
  GradesCriteriaSchema,
} from '../grades-criteria/schemas/grades-criteria.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { multerConfig } from './config/multer.config';
import { CaslModule } from 'src/casl/casl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectSubmission.name, schema: ProjectSubmissionSchema },
      { name: GradesCriteria.name, schema: GradesCriteriaSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
    CaslModule,
    MulterModule.register(multerConfig),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

