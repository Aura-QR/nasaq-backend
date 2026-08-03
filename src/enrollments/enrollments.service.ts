import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Enrollment } from './schemas/enrollment.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { BulkPromoteDto } from './dto/bulk-promote.dto';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevel>,
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

    // Check existing enrollment for student in this year
    const existing = await this.enrollmentModel.findOne({
      studentId: new mongoose.Types.ObjectId(studentId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
    }).exec();

    if (existing) {
      throw new ConflictException(`Student is already enrolled in an academic year class`);
    }

    const enrollment = new this.enrollmentModel({
      studentId: new mongoose.Types.ObjectId(studentId),
      classId: new mongoose.Types.ObjectId(classId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      status: 'active',
      enrolledAt: new Date(),
    });

    return enrollment.save();
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

    const enrollments = await this.enrollmentModel
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

    return enrollments.map((enc) => {
      const obj = enc.toObject({ virtuals: true });
      const studentObj = obj.studentId as any;
      return {
        ...obj,
        student: studentObj
          ? {
              ...studentObj,
              class: studentObj.classId,
              classId: studentObj.classId?._id ?? studentObj.classId ?? null,
            }
          : null,
      };
    });
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

    const sourceEnrollments = await this.enrollmentModel
      .find(sourceFilter)
      .populate('studentId', 'firstName familyName fatherName email')
      .populate({
        path: 'classId',
        select: 'name gradeLevelId',
        populate: { path: 'gradeLevelId', select: 'name order' },
      })
      .exec();

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
    const { promotions, excludedStudentIds = [] } = dto;
    const excludedSet = new Set(excludedStudentIds);

    const createdDocs = [];
    const errors = [];

    for (const promo of promotions) {
      if (excludedSet.has(promo.studentId)) continue;

      try {
        const enrollment = new this.enrollmentModel({
          studentId: new mongoose.Types.ObjectId(promo.studentId),
          classId: new mongoose.Types.ObjectId(promo.targetClassId),
          academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId),
          status: 'active',
          enrolledAt: new Date(),
        });

        await enrollment.save();
        createdDocs.push(enrollment);
      } catch (err: any) {
        errors.push({
          studentId: promo.studentId,
          error: err.message || 'Promotion failed',
        });
      }
    }

    return {
      message: 'Bulk promotion completed',
      createdCount: createdDocs.length,
      excludedCount: excludedSet.size,
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
