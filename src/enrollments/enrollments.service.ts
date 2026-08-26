import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Enrollment } from './schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { BulkPromoteDto, ExclusionReason } from './dto/bulk-promote.dto';
import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import { FinancialRecordService } from '../financial/financial-record.service';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevel>,
    private readonly gradesCriteriaService: GradesCriteriaService,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  async enroll(createEnrollmentDto: CreateEnrollmentDto) {
    const { studentId, classId, academicYearId } = createEnrollmentDto;

    // Validate student existence
    const student = await this.studentModel.findById(studentId).exec();
    if (!student) {
      throw new NotFoundException(`Student with ID ${studentId} not found`);
    }

    // Validate class existence
    const targetClass = await this.classModel.findById(classId).exec();
    if (!targetClass) {
      throw new NotFoundException(`Class with ID ${classId} not found`);
    }

    // Check capacity
    const currentEnrolledCount = await this.enrollmentModel.countDocuments({
      classId: new mongoose.Types.ObjectId(classId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      status: 'active',
    });

    if (currentEnrolledCount >= targetClass.maxCapacity) {
      throw new BadRequestException(
        `Class "${targetClass.name}" has reached its maximum capacity of ${targetClass.maxCapacity}`,
      );
    }

    // Check existing active enrollment for student in this year
    const existing = await this.enrollmentModel.findOne({
      studentId: new mongoose.Types.ObjectId(studentId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      status: 'active',
    }).exec();

    if (existing) {
      throw new ConflictException(`Student is already enrolled in an academic year class`);
    }

    // Pre-validate financial record preconditions before saving the enrollment document
    const schoolIdStr = (targetClass as any).schoolId?.toString();
    if (schoolIdStr) {
      await this.financialRecordService.assertCanCreateRecord(studentId, classId, schoolIdStr);
    }

    const enrollment = new this.enrollmentModel({
      studentId: new mongoose.Types.ObjectId(studentId),
      classId: new mongoose.Types.ObjectId(classId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      status: 'active',
      enrolledAt: new Date(),
    });

    const savedEnrollment = await enrollment.save();

    // Create/update the student's financial record for this academic year.
    if (schoolIdStr) {
      try {
        await this.financialRecordService.createOrUpdateRecord(studentId, classId, schoolIdStr);
      } catch (error) {
        await this.enrollmentModel.findByIdAndDelete(savedEnrollment._id).exec();
        throw error;
      }
    }

    // Keep student.classId synchronized
    await this.studentModel.findByIdAndUpdate(studentId, {
      classId: new mongoose.Types.ObjectId(classId),
    }).exec();

    return { message: 'تم تسجيل الطالب بنجاح', data: savedEnrollment };
  }

  async findByYearAndClass(academicYearId?: string, classId?: string, status?: string) {
    const filter: any = {};
    if (status && status !== 'all') {
      filter.status = status;
    } else if (!status) {
      filter.status = 'active';
    }

    if (academicYearId && mongoose.Types.ObjectId.isValid(academicYearId)) {
      filter.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      filter.classId = new mongoose.Types.ObjectId(classId);
    }

    return this.enrollmentModel
      .find(filter)
      .populate({
        path: 'studentId',
        select: '-password -otp -otpExpiry',
      })
      .populate({
        path: 'classId',
        select: 'name roomNumber gender gradeLevelId',
        populate: { path: 'gradeLevelId', select: 'name order' },
      })
      .populate('academicYearId', 'name status startDate endDate')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByStudent(studentId: string) {
    return this.enrollmentModel
      .find({ studentId: new mongoose.Types.ObjectId(studentId) })
      .populate('classId', 'name roomNumber gradeLevelId')
      .populate('academicYearId', 'name status startDate endDate')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Wizard Step 5 — Promotion Preview Data Generator
   * Generates a preview list of students in previous/active year with their current grade level,
   * suggested next grade level, and available target classes in the target academic year.
   */
  async getPromotionPreview(targetAcademicYearId: string, previousAcademicYearId?: string) {
    // Target classes in the new year
    const targetClasses = await this.classModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId) })
      .exec();

    // Group target classes by gradeLevelId string
    const targetClassesByGrade = new Map<string, any[]>();
    for (const cls of targetClasses) {
      const gId = cls.gradeLevelId.toString();
      if (!targetClassesByGrade.has(gId)) {
        targetClassesByGrade.set(gId, []);
      }
      targetClassesByGrade.get(gId)!.push({
        id: cls._id,
        name: cls.name,
        roomNumber: cls.roomNumber,
        maxCapacity: cls.maxCapacity,
      });
    }

    // Find source enrollments to promote
    const sourceFilter: any = { status: 'active' };
    if (previousAcademicYearId) {
      sourceFilter.academicYearId = new mongoose.Types.ObjectId(previousAcademicYearId);
    }

    const rawSourceEnrollments = await this.enrollmentModel
      .find(sourceFilter)
      .populate('studentId', 'firstName familyName fatherName email')
      .populate({
        path: 'classId',
        select: 'name gradeLevelId',
        populate: { path: 'gradeLevelId', select: 'name order' },
      })
      .populate('academicYearId', 'name startDate')
      .exec();

    /*
     * Everyone who already has an enrollment in the target year is done —
     * whatever the outcome. This is what makes the preview idempotent.
     *
     * Without it the preview simply listed every active enrollment in the
     * source year, so a student reappeared every time the screen was reopened,
     * with no way to tell that a decision had already been made about them. A
     * second promotion for the same student then failed silently against the
     * unique index and landed in `errors`.
     *
     * `distinct` is one of the methods tenantScopedPlugin scopes by schoolId,
     * so this cannot reach another school's enrollments.
     */
    const decidedStudentIds = await this.enrollmentModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId) })
      .distinct('studentId');
    const decidedSet = new Set(decidedStudentIds.map((id: any) => id.toString()));

    /*
     * One row per student, from their most recent year.
     *
     * A promoted student keeps status 'active' on the old enrollment as well as
     * the new one — deliberately, since 'promoted' is not in the schema's enum
     * and the check above already keeps them out of the next preview. But when
     * previousAcademicYearId is omitted the query spans every past year, so
     * that student carries two active enrollments and appeared TWICE: once
     * suggesting the grade after their old class, once after their new one.
     *
     * Keeping only the latest year per student is what makes the unfiltered
     * "everything still outstanding" view usable. With previousAcademicYearId
     * supplied there is at most one row per student anyway, so this is a no-op.
     */
    const latestByStudent = new Map<string, any>();
    for (const enc of rawSourceEnrollments) {
      const student = enc.studentId as any;
      if (!student?._id) continue;

      const key = student._id.toString();
      const existing = latestByStudent.get(key);
      if (!existing) {
        latestByStudent.set(key, enc);
        continue;
      }

      // Fall back to enrolledAt when a year has no startDate to compare on.
      const at = (e: any) =>
        new Date(e.academicYearId?.startDate ?? e.enrolledAt ?? 0).getTime();
      if (at(enc) > at(existing)) latestByStudent.set(key, enc);
    }

    const sourceEnrollments = [...latestByStudent.values()];

    // All grade levels sorted by order
    const allGradeLevels = await this.gradeLevelModel.find().sort({ order: 1 }).exec();
    const gradeOrderByOrderMap = new Map<number, any>();
    for (const g of allGradeLevels) {
      gradeOrderByOrderMap.set(g.order, g);
    }

    const previewList = [];

    for (const enc of sourceEnrollments) {
      const student = enc.studentId as any;
      const currentClass = enc.classId as any;
      if (!student || !currentClass || !currentClass.gradeLevelId) continue;
      if (decidedSet.has(student._id.toString())) continue;

      const currentGradeOrder = currentClass.gradeLevelId.order;
      const nextGrade = gradeOrderByOrderMap.get(currentGradeOrder + 1);

      let suggestedNextGrade = null;
      let availableClasses: any[] = [];
      let isGraduating = false;

      if (nextGrade) {
        suggestedNextGrade = {
          id: nextGrade._id,
          name: nextGrade.name,
          order: nextGrade.order,
        };
        availableClasses = targetClassesByGrade.get(nextGrade._id.toString()) || [];
      } else {
        isGraduating = true;
      }

      // academicYearId is populated now, so read the id off the document
      // rather than stringifying the whole object.
      const sourceYearId =
        previousAcademicYearId ||
        (enc.academicYearId as any)?._id?.toString() ||
        enc.academicYearId?.toString();
      let subjectResults: any[] = [];
      let overallPassed = true;

      const gradeLevelId = currentClass.gradeLevelId._id ?? currentClass.gradeLevelId;

      if (sourceYearId && gradeLevelId) {
        subjectResults = await this.gradesCriteriaService.calculateStudentYearlySubjectResults(
          student._id.toString(),
          gradeLevelId.toString(),
          sourceYearId,
        );

        const requiredSubjects = subjectResults.filter((s) => s.isRequiredForPromotion !== false);
        if (requiredSubjects.length === 0) {
          overallPassed = null;
        } else if (requiredSubjects.some((s) => s.passed === false)) {
          overallPassed = false;
        } else if (requiredSubjects.some((s) => s.passed === null)) {
          overallPassed = null;
        } else {
          overallPassed = true;
        }
      }

      previewList.push({
        studentId: student._id,
        studentName: `${student.firstName} ${student.fatherName || ''} ${student.familyName}`.trim(),
        currentClass: {
          id: currentClass._id,
          name: currentClass.name,
          gradeName: currentClass.gradeLevelId.name,
        },
        suggestedNextGrade,
        isGraduating,
        availableTargetClasses: availableClasses,
        subjectResults,
        overallPassed,
      });
    }

    return {
      targetAcademicYearId,
      totalStudents: previewList.length,
      students: previewList,
    };
  }

  /**
   * Wizard Step 5 — Bulk Promotion Execution
   */
  async bulkPromote(targetAcademicYearId: string, dto: BulkPromoteDto) {
    const {
      promotions,
      previousAcademicYearId,
      excludedStudents = [],
      excludedStudentIds = [],
    } = dto;

    /*
     * Two shapes, one list.
     *
     * excludedStudents carries the reason and is what the old enrollment is
     * closed out with. excludedStudentIds is the older shape the mobile client
     * still sends; those become 'withdrawn' — the neutral outcome, chosen over
     * guessing 'graduated' for someone who may simply have left.
     *
     * excludedStudents wins on a duplicate, since it is the one with a reason.
     */
    const exclusions = new Map<string, ExclusionReason>();
    for (const id of excludedStudentIds) exclusions.set(id, 'withdrawn');
    for (const e of excludedStudents) exclusions.set(e.studentId, e.reason);
    const excludedSet = new Set(exclusions.keys());

    const createdDocs = [];
    const errors = [];

    for (const promo of promotions) {
      if (excludedSet.has(promo.studentId)) continue;

      try {
        const targetCls = await this.classModel.findById(promo.targetClassId).exec();
        const schoolIdStr = targetCls ? (targetCls as any).schoolId?.toString() : undefined;

        if (schoolIdStr) {
          await this.financialRecordService.assertCanCreateRecord(
            promo.studentId,
            promo.targetClassId,
            schoolIdStr,
          );
        }

        const enrollment = new this.enrollmentModel({
          studentId: new mongoose.Types.ObjectId(promo.studentId),
          classId: new mongoose.Types.ObjectId(promo.targetClassId),
          academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId),
          status: 'active',
          enrolledAt: new Date(),
        });

        await enrollment.save();

        if (schoolIdStr) {
          try {
            await this.financialRecordService.createOrUpdateRecord(
              promo.studentId,
              promo.targetClassId,
              schoolIdStr,
            );
          } catch (financialError: any) {
            await this.enrollmentModel.findByIdAndDelete(enrollment._id).exec();
            throw financialError;
          }
        }

        createdDocs.push(enrollment);
      } catch (err: any) {
        errors.push({
          studentId: promo.studentId,
          error: err.message || 'Promotion failed',
        });
      }
    }

    /*
     * Close out the excluded students' old enrollment.
     *
     * Nothing used to record that a decision had been made: an excluded
     * student's enrollment stayed 'active' forever, so they resurfaced in
     * every future preview with no trace of having been dealt with.
     *
     * Promoted students are deliberately NOT touched here — 'promoted' is not
     * in the schema enum, and getPromotionPreview already excludes anyone
     * holding an enrollment in the target year, which covers them.
     */
    let excludedUpdated = 0;
    for (const [studentId, reason] of exclusions) {
      const filter: any = {
        studentId: new mongoose.Types.ObjectId(studentId),
        status: 'active',
      };

      if (previousAcademicYearId) {
        filter.academicYearId = new mongoose.Types.ObjectId(previousAcademicYearId);
      } else {
        // The client did not say which year. Their active enrollment outside
        // the target year is the one being closed; a student has at most one
        // per year thanks to the unique index, so the sort picks the newest.
        filter.academicYearId = { $ne: new mongoose.Types.ObjectId(targetAcademicYearId) };
      }

      const target = await this.enrollmentModel
        .findOne(filter)
        .sort({ enrolledAt: -1 })
        .select('_id')
        .exec();

      if (!target) {
        errors.push({
          studentId,
          error: 'لا يوجد تسجيل نشط لهذا الطالب في السنة السابقة',
        });
        continue;
      }

      await this.enrollmentModel
        .updateOne({ _id: target._id }, { $set: { status: reason } })
        .exec();
      excludedUpdated++;
    }

    return {
      message: 'Bulk promotion completed',
      createdCount: createdDocs.length,
      excludedCount: excludedSet.size,
      excludedUpdated,
      errors,
    };
  }

  async unenroll(id: string, reason = 'withdrawn') {
    const updated = await this.enrollmentModel
      .findByIdAndUpdate(id, { status: reason }, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException(`Enrollment with ID ${id} not found`);
    }

    return updated;
  }
}
