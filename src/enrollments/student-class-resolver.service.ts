import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Enrollment } from './schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { AcademicYear } from '../academic-years/schemas/academic-year.schema';

/**
 * Which class is a student in *right now*?
 *
 * Four services used to answer this the same wrong way:
 *
 *     const enrollments = await this.enrollmentModel.find({ studentId })
 *     enrollments.forEach(e => classIdsSet.add(e.classId.toString()))
 *     if (student.classId) classIdsSet.add(student.classId.toString())
 *
 * No year filter, no status filter, and the student's own classId thrown in on
 * top. Promotion creates a NEW enrollment and leaves the old one 'active', so
 * a student promoted from grade 2 to grade 3 held two enrollments and that
 * union returned BOTH classes — they saw grade 2's subjects, exams, projects
 * and grading criteria alongside grade 3's.
 *
 * The answer is a choice, not a union: the active year wins.
 */
@Injectable()
export class StudentClassResolverService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(AcademicYear.name) private readonly academicYearModel: Model<AcademicYear>,
  ) {}

  async resolveClassIds(studentId: string | Types.ObjectId): Promise<string[]> {
    if (!studentId || !Types.ObjectId.isValid(String(studentId))) return [];
    const sid = new Types.ObjectId(String(studentId));

    // 1. The active year. The unique index on (schoolId, studentId,
    //    academicYearId) means this is at most one enrollment.
    const activeYear = await this.academicYearModel
      .findOne({ status: 'active' })
      .select('_id')
      .lean()
      .exec();

    if (activeYear) {
      const current = await this.enrollmentModel
        .find({ studentId: sid, academicYearId: activeYear._id, status: 'active' })
        .select('classId')
        .lean()
        .exec();

      const ids = current.map((e: any) => e.classId).filter(Boolean).map(String);
      if (ids.length) return [...new Set(ids)];
    }

    /*
     * 2. No active year, or the student is not enrolled in it — a school
     *    mid-setup, or a student added before the year was opened. Falling
     *    through to their most recent enrollment keeps their screens working
     *    instead of going blank, and it is still ONE year, not all of them.
     *
     *    Still 'active' only, matching step 1: a graduated, transferred or
     *    withdrawn enrollment is a closed chapter, not a current class. A
     *    student withdrawn this year therefore resolves to their last year
     *    they were actually attending, exactly like a student who was never
     *    enrolled in the active year.
     */
    const all = await this.enrollmentModel
      .find({ studentId: sid, status: 'active' })
      .select('classId academicYearId enrolledAt')
      .populate('academicYearId', 'startDate')
      .lean()
      .exec();

    if (all.length) {
      const at = (e: any) =>
        new Date((e.academicYearId as any)?.startDate ?? e.enrolledAt ?? 0).getTime();
      const newest = [...all].sort((a, b) => at(b) - at(a))[0] as any;
      if (newest?.classId) return [String(newest.classId)];
    }

    /*
     * 3. Never enrolled at all. student.classId is last, not first: promotion
     *    updates it now, but a record written before that change can still be
     *    pointing at the class the student left.
     */
    const student = await this.studentModel
      .findById(sid)
      .select('classId')
      .lean()
      .exec();

    return (student as any)?.classId ? [String((student as any).classId)] : [];
  }
}
