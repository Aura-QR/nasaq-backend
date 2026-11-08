import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PreparationContentService } from './preparation-content.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import {
  PreparationResource,
  PreparationResourceSchema,
} from './schemas/preparation-resource.schema';
import {
  CurriculumLesson,
  CurriculumLessonSchema,
} from '../curriculum/schemas/curriculum-lesson.schema';
import {
  CurriculumUnit,
  CurriculumUnitSchema,
} from '../curriculum/schemas/curriculum-unit.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { Library, LibrarySchema } from '../library/schemas/library.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import {
  Enrollment,
  EnrollmentSchema,
} from '../enrollments/schemas/enrollment.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { HomeworkService } from './homework.service';
import { HomeworkSubmissionService } from './homework-submission.service';
import { HomeworkSubmission, HomeworkSubmissionSchema } from './schemas/homework-submission.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Preparation.name, schema: PreparationSchema },
      { name: PreparationResource.name, schema: PreparationResourceSchema },
      { name: CurriculumLesson.name, schema: CurriculumLessonSchema },
      { name: CurriculumUnit.name, schema: CurriculumUnitSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: Library.name, schema: LibrarySchema },
      { name: Exam.name, schema: ExamSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Student.name, schema: StudentSchema },
      // Homework due dates come from the timetable; the student list names the teacher.
      { name: Lecture.name, schema: LectureSchema },
      { name: Teacher.name, schema: TeacherSchema },
      // Students hand lesson homework in; the teacher's list names the class.
      { name: HomeworkSubmission.name, schema: HomeworkSubmissionSchema },
      { name: Class.name, schema: ClassSchema },
    ]),
    NotificationsModule,
  ],
  providers: [PreparationContentService, HomeworkService, HomeworkSubmissionService],
  exports: [PreparationContentService, HomeworkService, HomeworkSubmissionService, MongooseModule],
})
export class PreparationContentModule {}
