import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateLectureDto } from './dto/create-lecture.dto';
import { UpdateLectureDto } from './dto/update-lecture.dto';
import { Lecture } from './schemas/lecture.schema';
import { Class } from '../classes/schemas/class.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Student } from 'src/students/schemas/student.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { TeacherAssignment } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Term } from '../terms/schemas/term.schema';

@Injectable()
export class LecturesService {
  constructor(
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(SubjectOffering.name) private readonly subjectOfferingModel: Model<SubjectOffering>,
    @InjectModel(TeacherAssignment.name) private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
  ) {}

  async create(createLectureDto: CreateLectureDto) {
    const { classId, subjectOfferingId, termId, teacherId, dayOfWeek, slot } = createLectureDto;

    // Check if slot in class is already booked for this term
    const classConflict = await this.lectureModel.findOne({
      classId: new mongoose.Types.ObjectId(classId),
      dayOfWeek,
      slot,
      termId: new mongoose.Types.ObjectId(termId),
    }).exec();

    if (classConflict) {
      throw new ConflictException(
        `Class already has a lecture scheduled on ${dayOfWeek} at slot ${slot} in this term`,
      );
    }

    // If teacher is provided, check for teacher double-booking
    if (teacherId) {
      const teacherConflict = await this.lectureModel.findOne({
        teacherId: new mongoose.Types.ObjectId(teacherId),
        dayOfWeek,
        slot,
        termId: new mongoose.Types.ObjectId(termId),
      }).exec();

      if (teacherConflict) {
        throw new ConflictException(
          `Teacher is already teaching another class on ${dayOfWeek} at slot ${slot} in this term`,
        );
      }
    }

    const newLecture = new this.lectureModel({
      classId: new mongoose.Types.ObjectId(classId),
      subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
      termId: new mongoose.Types.ObjectId(termId),
      teacherId: teacherId ? new mongoose.Types.ObjectId(teacherId) : null,
      dayOfWeek,
      slot,
    });

    await newLecture.save();
    return this.findOne(newLecture._id.toString());
  }

  async findAll(termId?: string, classId?: string, teacherId?: string) {
    const filter: any = {};
    if (termId) filter.termId = new mongoose.Types.ObjectId(termId);
    if (classId) filter.classId = new mongoose.Types.ObjectId(classId);
    if (teacherId) filter.teacherId = new mongoose.Types.ObjectId(teacherId);

    return this.lectureModel
      .find(filter)
      .populate('classId', 'name roomNumber gender')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
        ],
      })
      .populate('teacherId', 'name email phoneNumber')
      .populate('termId', 'name order status')
      .sort({ dayOfWeek: 1, slot: 1 })
      .exec();
  }

  /**
   * The caller's own timetable. Never accepts a teacherId — the id is taken from
   * the token, so one teacher cannot read another's schedule.
   */
  async findMyTeacherLectures(teacherId: string, termId?: string) {
    const resolvedTermId = termId ?? (await this.getActiveTermId());
    return this.findAll(resolvedTermId, undefined, teacherId);
  }

  /**
   * A student's own timetable, resolved through their active enrollment:
   * student -> classId -> the lectures scheduled for that class.
   */
  async findMyStudentLectures(studentId: string, termId?: string) {
    const student = await this.studentModel
      .findById(studentId)
      .select('classId')
      .exec();

    if (!student) {
      throw new NotFoundException('الطالب غير موجود');
    }
    if (!student.classId) {
      throw new BadRequestException('الطالب غير مسجل في أي فصل');
    }

    const resolvedTermId = termId ?? (await this.getActiveTermId());
    return this.findAll(resolvedTermId, student.classId.toString(), undefined);
  }

  /**
   * Falls back to the active term so the apps can call /me with no arguments.
   * Returns undefined when no term is active, which makes findAll return
   * every term rather than nothing.
   */
  private async getActiveTermId(): Promise<string | undefined> {
    const activeTerm = await this.termModel
      .findOne({ status: 'active' })
      .select('_id')
      .exec();
    return activeTerm ? activeTerm._id.toString() : undefined;
  }

  async findOne(id: string) {
    const lecture = await this.lectureModel
      .findById(id)
      .populate('classId', 'name roomNumber gender')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
        ],
      })
      .populate('teacherId', 'name email phoneNumber')
      .populate('termId', 'name order status')
      .exec();

    if (!lecture) {
      throw new NotFoundException(`Lecture with ID ${id} not found`);
    }
    return lecture;
  }

  async update(id: string, updateDto: UpdateLectureDto) {
    const updated = await this.lectureModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .populate('classId', 'name roomNumber gender')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
        ],
      })
      .populate('teacherId', 'name email phoneNumber')
      .exec();

    if (!updated) {
      throw new NotFoundException(`Lecture with ID ${id} not found`);
    }
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.lectureModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Lecture with ID ${id} not found`);
    }
    return deleted;
  }

  /**
   * Wizard Step 7 — Copy Schedule Engine
   * Implements §3 of the spec and Decision #6 from user feedback.
   * Returns 4 distinct buckets: created, unresolved, needsTeacher, teacherConflict.
   */
  async copySchedule(targetAcademicYearId: string, targetTermId: string, sourceTermId: string) {
    const sourceLectures = await this.lectureModel
      .find({ termId: new mongoose.Types.ObjectId(sourceTermId) })
      .populate({
        path: 'classId',
        select: 'name gradeLevelId roomNumber',
      })
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName' },
          { path: 'gradeLevelId', select: 'name' },
        ],
      })
      .exec();

    if (sourceLectures.length === 0) {
      throw new NotFoundException('No lectures found in the source term to copy');
    }

    // Hard-block per §3.6: check if target term has subject offerings
    const targetOfferings = await this.subjectOfferingModel
      .find({ termId: new mongoose.Types.ObjectId(targetTermId) })
      .exec();

    if (targetOfferings.length === 0) {
      throw new BadRequestException(
        'Set up subjects for this term first before copying the schedule (No SubjectOfferings found in target term)',
      );
    }

    // Fetch target classes in target year
    const targetClasses = await this.classModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId) })
      .exec();

    // Index target classes by "gradeLevelId_className"
    const targetClassMap = new Map<string, any>();
    for (const tc of targetClasses) {
      const key = `${tc.gradeLevelId.toString()}_${tc.name}`;
      targetClassMap.set(key, tc);
    }

    // Index target offerings by "gradeLevelId_subjectId"
    const targetOfferingMap = new Map<string, any>();
    for (const to of targetOfferings) {
      const key = `${to.gradeLevelId.toString()}_${to.subjectId.toString()}`;
      targetOfferingMap.set(key, to);
    }

    // Fetch target teacher assignments
    const targetOfferingIds = targetOfferings.map((to) => to._id);
    const targetAssignments = await this.teacherAssignmentModel
      .find({ subjectOfferingId: { $in: targetOfferingIds } })
      .exec();

    // Index target teacher assignments by "subjectOfferingId_teacherId"
    const targetAssignmentSet = new Set<string>();
    for (const ta of targetAssignments) {
      targetAssignmentSet.add(`${ta.subjectOfferingId.toString()}_${ta.teacherId.toString()}`);
    }

    // Existing lectures in target term for conflict checking
    const existingTargetLectures = await this.lectureModel
      .find({ termId: new mongoose.Types.ObjectId(targetTermId) })
      .exec();

    const bookedClassSlots = new Set<string>(); // "classId_day_slot"
    const bookedTeacherSlots = new Set<string>(); // "teacherId_day_slot"

    for (const el of existingTargetLectures) {
      bookedClassSlots.add(`${el.classId.toString()}_${el.dayOfWeek}_${el.slot}`);
      if (el.teacherId) {
        bookedTeacherSlots.add(`${el.teacherId.toString()}_${el.dayOfWeek}_${el.slot}`);
      }
    }

    const created = [];
    const unresolved = [];
    const needsTeacher = [];
    const teacherConflict = [];

    for (const sourceLec of sourceLectures) {
      const srcClass = sourceLec.classId as any;
      const srcOffering = sourceLec.subjectOfferingId as any;

      if (!srcClass || !srcOffering) {
        unresolved.push({
          sourceLectureId: sourceLec._id,
          reason: 'Source class or offering missing',
        });
        continue;
      }

      // Step a & b: Resolve target Class via (gradeLevelId + class name)
      const classKey = `${srcClass.gradeLevelId.toString()}_${srcClass.name}`;
      const targetClass = targetClassMap.get(classKey);

      if (!targetClass) {
        unresolved.push({
          sourceLectureId: sourceLec._id,
          title: `Class ${srcClass.name} — ${srcOffering.subjectId?.subjectName || 'Subject'} (${sourceLec.dayOfWeek} Slot ${sourceLec.slot})`,
          reason: `no matching class — لا يوجد فصل جديد باسم "${srcClass.name}" لهذا الصف الدراسي`,
        });
        continue;
      }

      // Step c: Resolve target SubjectOffering via (gradeLevelId + subjectId)
      const offeringKey = `${targetClass.gradeLevelId.toString()}_${srcOffering.subjectId?._id?.toString() || srcOffering.subjectId?.toString()}`;
      const targetOffering = targetOfferingMap.get(offeringKey);

      if (!targetOffering) {
        unresolved.push({
          sourceLectureId: sourceLec._id,
          title: `Class ${targetClass.name} — ${srcOffering.subjectId?.subjectName || 'Subject'} (${sourceLec.dayOfWeek} Slot ${sourceLec.slot})`,
          reason: 'no matching subject offering — لم يتم إعداد عرض المادة لهذا الترم بعد',
        });
        continue;
      }

      // Check slot conflict in target class
      const classSlotKey = `${targetClass._id.toString()}_${sourceLec.dayOfWeek}_${sourceLec.slot}`;
      if (bookedClassSlots.has(classSlotKey)) {
        unresolved.push({
          sourceLectureId: sourceLec._id,
          title: `Class ${targetClass.name} — ${srcOffering.subjectId?.subjectName || 'Subject'} (${sourceLec.dayOfWeek} Slot ${sourceLec.slot})`,
          reason: 'slot conflict — يوجد حصة مسجلة بالفعل في هذا الفصل والوقت',
        });
        continue;
      }

      // Step d: Resolve TeacherAssignment for target offering
      let assignedTeacherId: mongoose.Types.ObjectId | null = null;
      let teacherFlag: 'ok' | 'needsTeacher' | 'teacherConflict' = 'ok';

      if (sourceLec.teacherId) {
        const srcTeacherIdStr = sourceLec.teacherId.toString();
        const assignmentKey = `${targetOffering._id.toString()}_${srcTeacherIdStr}`;

        if (targetAssignmentSet.has(assignmentKey)) {
          // Teacher has assignment in target year. Now check teacher double-booking in target term
          const teacherSlotKey = `${srcTeacherIdStr}_${sourceLec.dayOfWeek}_${sourceLec.slot}`;

          if (bookedTeacherSlots.has(teacherSlotKey)) {
            // Decision #6: Teacher collision -> leave teacher null, add to teacherConflict bucket
            assignedTeacherId = null;
            teacherFlag = 'teacherConflict';
          } else {
            assignedTeacherId = sourceLec.teacherId as any;
          }
        } else {
          // Teacher has no active assignment for this offering in target year
          assignedTeacherId = null;
          teacherFlag = 'needsTeacher';
        }
      } else {
        teacherFlag = 'needsTeacher';
      }

      // Create new lecture doc
      const newLecDoc = new this.lectureModel({
        classId: targetClass._id,
        subjectOfferingId: targetOffering._id,
        termId: new mongoose.Types.ObjectId(targetTermId),
        teacherId: assignedTeacherId,
        dayOfWeek: sourceLec.dayOfWeek,
        slot: sourceLec.slot,
      });

      await newLecDoc.save();

      // Track booked slots
      bookedClassSlots.add(classSlotKey);
      if (assignedTeacherId) {
        bookedTeacherSlots.add(`${assignedTeacherId.toString()}_${sourceLec.dayOfWeek}_${sourceLec.slot}`);
      }

      const itemSummary = {
        lectureId: newLecDoc._id,
        title: `Class ${targetClass.name} — ${srcOffering.subjectId?.subjectName || 'Subject'} (${sourceLec.dayOfWeek} Slot ${sourceLec.slot})`,
      };

      if (teacherFlag === 'ok') {
        created.push(itemSummary);
      } else if (teacherFlag === 'needsTeacher') {
        needsTeacher.push({
          ...itemSummary,
          reason: 'المعلم الحالي لا يملك تكليف تدريس فعّال لهذه المادة في السنة الجديدة',
        });
      } else if (teacherFlag === 'teacherConflict') {
        teacherConflict.push({
          ...itemSummary,
          reason: 'تعارض في جدول المعلم — المعلم معين لحصة أخرى في نفس الوقت في فصل آخر',
        });
      }
    }

    return {
      message: 'Copy schedule completed',
      createdCount: created.length,
      unresolvedCount: unresolved.length,
      needsTeacherCount: needsTeacher.length,
      teacherConflictCount: teacherConflict.length,
      created,
      unresolved,
      needsTeacher,
      teacherConflict,
    };
  }
}
