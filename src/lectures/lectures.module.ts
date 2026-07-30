import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LecturesController } from './lectures.controller';
import { LecturesService } from './lectures.service';
import { Lecture, LectureSchema } from './schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Student, StudentSchema } from 'src/students/schemas/student.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { TeacherAssignment, TeacherAssignmentSchema } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lecture.name, schema: LectureSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Student.name, schema: StudentSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
      { name: Term.name, schema: TermSchema },
    ]),
  ],
  controllers: [LecturesController],
  providers: [LecturesService],
  exports: [LecturesService, MongooseModule],
})
export class LecturesModule {}
