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
import { Subject } from '../subjects/schemas/subject.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Student } from 'src/students/schemas/student.schema';
import { transformLectureResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';

@Injectable()
export class LecturesService {
  // Constants for common field configurations
  private readonly POPULATE_FIELDS = {
    classBasic: 'academicYear roomNumber',
    classDetailed: 'academicYear roomNumber gender maxCapacity',
    subjectBasic: 'subjectName subjectCode',
    teacherBasic: 'name',
    teacherDetailed: 'name email specialization'
  };

  private readonly TEXT_SEARCH_FIELDS = ['roomNumber'];
  private readonly OBJECT_ID_FIELDS = ['classId', 'subjectId', 'teacherId', '_id'];
  private readonly EXACT_MATCH_FIELDS = ['dayOfWeek'];

  constructor(
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<Subject>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>
  ) {}

  async create(createLectureDto: CreateLectureDto) {
    this.validateCreateInput(createLectureDto);

    await this.validateRequiredIds(
      createLectureDto.classId, 
      createLectureDto.subjectId, 
      createLectureDto.teacherId
    );

    await this.verifyBusinessLogic(
      createLectureDto.classId,
      createLectureDto.subjectId,
      createLectureDto.teacherId
    );

    const duplicateLecture = await this.findDuplicateLecture(
      createLectureDto.classId,
      createLectureDto.subjectId,
      createLectureDto.teacherId,
      createLectureDto.dayOfWeek,
      createLectureDto.slot,
    );

    if (duplicateLecture) {
      const subjectInfo = `${duplicateLecture['subjectId']['subjectName']} (${duplicateLecture['subjectId']['subjectCode']})`;
      const roomInfo = duplicateLecture['classId']['roomNumber'];
      const academicYear = duplicateLecture['classId']['academicYear'];
      const teacherName = duplicateLecture['teacherId']['name'];
      throw new ConflictException(
        `Duplicate lecture detected: ${subjectInfo} with teacher ${teacherName} in Room ${roomInfo} (${academicYear}) at ${createLectureDto.dayOfWeek} Slot ${createLectureDto.slot} already exists. Lecture ID: ${duplicateLecture._id}`
      );
    }

    await this.checkConflicts(
      createLectureDto.classId,
      createLectureDto.teacherId,
      createLectureDto.dayOfWeek,
      createLectureDto.slot
    );
    
    const newLecture = new this.lectureModel(createLectureDto);
    await newLecture.save();

    await newLecture.populate(this.buildPopulateOptions(true));

    return {
      message: 'تم إنشاء المحاضرة بنجاح',
      data: transformLectureResponse(newLecture),
    };
  }

  async filtering(filters: any, pagination: PaginationDto = {}, user?: any) {
    const query: any = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;

      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'slot') {
        query[key] = Number(stringValue);
      } else if (this.OBJECT_ID_FIELDS.includes(key)) {
        if (!mongoose.Types.ObjectId.isValid(stringValue)) {
          throw new BadRequestException(`صيغة ${key} غير صحيحة`);
        }
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else if (key === 'dayOfWeek') {
        query[key] = stringValue.toLowerCase();
      } else if (this.TEXT_SEARCH_FIELDS.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (this.EXACT_MATCH_FIELDS.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }


    if (user?.role === 'TEACHER') 
      query['teacherId'] = user.userId;
    

    const total = await this.lectureModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let lecturesQuery = this.lectureModel
      .find(query).sort({ createdAt: -1 })
      .populate(this.buildPopulateOptions(true))
      .sort({ dayOfWeek: 1, slot: 1 });

    if (isPaginationRequested) {
      lecturesQuery = lecturesQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const lectures = await lecturesQuery.exec();

    if (isPaginationRequested) {
      return {
        data: lectures.map((lecture) => transformLectureResponse(lecture)),
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages
      };
    }

    return lectures.map((lecture) => transformLectureResponse(lecture));
  }

  async findOne(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة معرف المحاضرة غير صحيحة');
    }

    const lecture = await this.lectureModel
      .findById(id)
      .populate(this.buildPopulateOptions(true))
      .exec();

    if (!lecture) {
      throw new NotFoundException(`المحاضرة ذات المعرف ${id} غير موجودة`);
    }

    return {
      message: 'تم استرجاع المحاضرة بنجاح',
      data: transformLectureResponse(lecture),
    };
  }

  async update(id: string, updateLectureDto: UpdateLectureDto) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة معرف المحاضرة غير صحيحة');
    }

    this.validateUpdateInput(updateLectureDto);

    // Check if lecture exists
    const existingLecture = await this.lectureModel.findById(id);
    if (!existingLecture) {
      throw new NotFoundException(`المحاضرة ذات المعرف ${id} غير موجودة`);
    }

    // Determine final values after update (for validation)
    const finalClassId = updateLectureDto.classId || existingLecture.classId.toString();
    const finalSubjectId = updateLectureDto.subjectId || existingLecture.subjectId.toString();
    const finalTeacherId = updateLectureDto.teacherId || existingLecture.teacherId.toString();
    const finalDayOfWeek = updateLectureDto.dayOfWeek || existingLecture.dayOfWeek;
    const finalSlot = updateLectureDto.slot ?? existingLecture.slot;

    // Validate entity existence if any of them changed
    if (updateLectureDto.classId || updateLectureDto.subjectId || updateLectureDto.teacherId) {
      await this.validateRequiredIds(finalClassId, finalSubjectId, finalTeacherId);
      await this.verifyBusinessLogic(finalClassId, finalSubjectId, finalTeacherId);
    }

    // Check for duplicate lecture (same class, subject, teacher, day, slot)
    if (
      updateLectureDto.classId ||
      updateLectureDto.subjectId ||
      updateLectureDto.teacherId ||
      updateLectureDto.dayOfWeek ||
      updateLectureDto.slot !== undefined
    ) {
      const duplicateLecture = await this.findDuplicateLecture(
        finalClassId,
        finalSubjectId,
        finalTeacherId,
        finalDayOfWeek,
        finalSlot,
        id,
      );

      if (duplicateLecture) {
        const subjectInfo = `${duplicateLecture['subjectId']['subjectName']} (${duplicateLecture['subjectId']['subjectCode']})`;
        const roomInfo = duplicateLecture['classId']['roomNumber'];
        const academicYear = duplicateLecture['classId']['academicYear'];
        const teacherName = duplicateLecture['teacherId']['name'];
        throw new ConflictException(
          `Duplicate lecture detected: ${subjectInfo} with teacher ${teacherName} in Room ${roomInfo} (${academicYear}) at ${finalDayOfWeek} Slot ${finalSlot} already exists. Lecture ID: ${duplicateLecture._id}`
        );
      }
    }

    // Check for conflicts if time, class, or teacher changed
    if (
      updateLectureDto.classId ||
      updateLectureDto.teacherId ||
      updateLectureDto.dayOfWeek ||
      updateLectureDto.slot !== undefined
    ) {
      await this.checkConflicts(
        finalClassId,
        finalTeacherId,
        finalDayOfWeek,
        finalSlot,
        id, // Exclude current lecture from conflict check
      );
    }

    const updatedLecture = await this.lectureModel
      .findByIdAndUpdate(id, updateLectureDto, { new: true })
      .populate(this.buildPopulateOptions(true))
      .exec();

    return {
      message: 'تم تحديث المحاضرة بنجاح',
      data: transformLectureResponse(updatedLecture),
    };
  }

  async remove(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة معرف المحاضرة غير صحيحة');
    }

    const lecture = await this.lectureModel.findById(id);
    if (!lecture) {
      throw new NotFoundException(`المحاضرة ذات المعرف ${id} غير موجودة`);
    }

    await this.lectureModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المحاضرة بنجاح',
    };
  }

  async getStudentLectures(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة معرف الطالب غير صحيحة');
    }

    const student = await this.studentModel.findById(id);
    if (!student) {
      throw new NotFoundException(`الطالب ذو المعرف ${id} غير موجود`);
    }

    if (!student.classId) {
      return {
        message: 'الطالب غير مسجل في أي فصل',
        data: [],
      };
    }
    
    const lectures = await this.lectureModel
      .find({ classId: student.classId })
      .populate(this.buildPopulateOptions(true))
      .sort({ dayOfWeek: 1, slot: 1 })
      .exec();

    return {
      message: 'تم استرجاع محاضرات الطالب بنجاح',
      data: lectures.map((lecture) => transformLectureResponse(lecture)),
    };
  }

  async getMySchedule(studentId: string) {
    return this.getStudentLectures(studentId);
  }

  async getTeacherClasses(teacherId: string, subjectId?: string) {
    const query: any = { teacherId: new mongoose.Types.ObjectId(teacherId) };
    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      query.subjectId = new mongoose.Types.ObjectId(subjectId);
    }

    const lectures = await this.lectureModel
      .find(query)
      .populate({ path: 'classId', select: 'roomNumber academicYear gender' })
      .populate({ path: 'subjectId', select: 'subjectName subjectCode' })
      .exec();

    // Group unique classes per subject
    const subjectMap = new Map<string, { subject: any; classes: any[] }>();
    for (const lecture of lectures as any[]) {
      const sId = lecture.subjectId._id.toString();
      if (!subjectMap.has(sId)) {
        subjectMap.set(sId, { subject: lecture.subjectId, classes: [] });
      }
      const entry = subjectMap.get(sId);
      const alreadyAdded = entry.classes.some(
        c => c._id.toString() === lecture.classId._id.toString(),
      );
      if (!alreadyAdded) entry.classes.push(lecture.classId);
    }

    const data = [...subjectMap.values()];
    return { message: 'تم استرجاع فصول المعلم بنجاح', data };
  }

  async createBulk(arrayOfLectures: CreateLectureDto[]) {
    if (!arrayOfLectures || arrayOfLectures.length === 0) {
      throw new BadRequestException('مصفوفة المحاضرات لا يمكن أن تكون فارغة');
    }

    const validatedLectures = [];
    const errors = [];

    for (let i = 0; i < arrayOfLectures.length; i++) {
      const lecture = arrayOfLectures[i];

      try {
        this.validateCreateInput(lecture);

        await this.validateRequiredIds(
          lecture.classId,
          lecture.subjectId,
          lecture.teacherId,
        );

        await this.verifyBusinessLogic(
          lecture.classId,
          lecture.subjectId,
          lecture.teacherId,
        );

        validatedLectures.push(lecture);
      } catch (error) {
        // Get class and subject data for better error message
        let roomInfo = 'N/A';
        let subjectInfo = 'Lecture';
        try {
          const classData = await this.classModel.findById(lecture.classId);
          if (classData) {
            roomInfo = classData.roomNumber;
          }
        } catch {}
        try {
          const subjectData = await this.subjectModel.findById(lecture.subjectId);
          if (subjectData) {
            subjectInfo = `${subjectData.subjectName} (${subjectData.subjectCode})`;
          }
        } catch {}

        errors.push({
          index: i,
          lecture: lecture,
          error: `${subjectInfo} in class ${roomInfo} (${lecture.dayOfWeek || 'N/A'} Slot ${lecture.slot || 'N/A'}) - ${error.message}`,
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: errors.map(e => e.error).join(' | '),
        errors: errors,
      });
    }

    const classDataMap = new Map();
    const subjectDataMap = new Map();

    // Pre-fetch class and subject data for conflict checking
    for (const lecture of validatedLectures) {
      if (!classDataMap.has(lecture.classId)) {
        try {
          const classData = await this.classModel.findById(lecture.classId);
          classDataMap.set(lecture.classId, classData);
        } catch {}
      }
      if (!subjectDataMap.has(lecture.subjectId)) {
        try {
          const subjectData = await this.subjectModel.findById(lecture.subjectId);
          subjectDataMap.set(lecture.subjectId, subjectData);
        } catch {}
      }
    }

    // Check for conflicts between lectures
    for (let i = 0; i < validatedLectures.length; i++) {
      const lecture = validatedLectures[i];
      const lectureClass = classDataMap.get(lecture.classId);
      const lectureRoom = lectureClass?.roomNumber || 'N/A';
      const lectureSubject = subjectDataMap.get(lecture.subjectId);

      try {
        await this.checkConflicts(
          lecture.classId,
          lecture.teacherId,
          lecture.dayOfWeek,
          lecture.slot,
        );

        // Check conflicts between lectures in the same batch
        for (let j = i + 1; j < validatedLectures.length; j++) {
          const otherLecture = validatedLectures[j];
          const otherLectureClass = classDataMap.get(otherLecture.classId);
          const otherLectureRoom = otherLectureClass?.roomNumber || 'N/A';
          const otherLectureSubject = subjectDataMap.get(otherLecture.subjectId);

          if (
            lecture.dayOfWeek === otherLecture.dayOfWeek &&
            lecture.slot === otherLecture.slot
          ) {
            if (lecture.classId === otherLecture.classId) {
              const subject1 = `${lectureSubject?.subjectName || 'N/A'} (${lectureSubject?.subjectCode || 'N/A'})`;
              const subject2 = `${otherLectureSubject?.subjectName || 'N/A'} (${otherLectureSubject?.subjectCode || 'N/A'})`;
              throw new ConflictException(
                `${subject1} and ${subject2} conflict in class ${lectureRoom} - both scheduled at ${lecture.dayOfWeek} Slot ${lecture.slot}`,
              );
            }

            if (lecture.teacherId === otherLecture.teacherId) {
              const subject1 = `${lectureSubject?.subjectName || 'N/A'} (${lectureSubject?.subjectCode || 'N/A'})`;
              const subject2 = `${otherLectureSubject?.subjectName || 'N/A'} (${otherLectureSubject?.subjectCode || 'N/A'})`;
              throw new ConflictException(
                `${subject1} and ${subject2} conflict - same teacher scheduled for class ${lectureRoom} and class ${otherLectureRoom} at ${lecture.dayOfWeek} Slot ${lecture.slot}`,
              );
            }

            if (lectureRoom !== 'N/A' && lectureRoom === otherLectureRoom && lecture.classId !== otherLecture.classId) {
              const subject1 = `${lectureSubject?.subjectName || 'N/A'} (${lectureSubject?.subjectCode || 'N/A'})`;
              const subject2 = `${otherLectureSubject?.subjectName || 'N/A'} (${otherLectureSubject?.subjectCode || 'N/A'})`;
              throw new ConflictException(
                `${subject1} and ${subject2} conflict - same room ${lectureRoom} scheduled at ${lecture.dayOfWeek} Slot ${lecture.slot}`,
              );
            }
          }
        }
      } catch (error) {
        errors.push({
          index: i,
          lecture: lecture,
          error: error.message,
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: errors.map(e => e.error).join(' | '),
        errors: errors,
      });
    }

    const createdLectures = await this.lectureModel.insertMany(validatedLectures);

    const populatedLectures = await this.lectureModel
      .find({ _id: { $in: createdLectures.map((lec) => lec._id) } })
      .populate(this.buildPopulateOptions(true))
      .exec();

    return {
      message: `تم إنشاء ${createdLectures.length} محاضرة بنجاح`,
      data: populatedLectures.map((lecture) => transformLectureResponse(lecture)),
    };
  }

  // Helper methods
  private async findDuplicateLecture(
    classId: string,
    subjectId: string,
    teacherId: string,
    dayOfWeek: any,
    slot: number,
    excludeId?: string,
  ) {
    const query: any = {
      classId,
      subjectId,
      teacherId,
      dayOfWeek,
      slot,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    return await this.lectureModel.findOne(query).populate([
      { path: 'classId', select: 'roomNumber academicYear' },
      { path: 'subjectId', select: 'subjectName subjectCode' },
      { path: 'teacherId', select: 'name' },
    ]);
  }

  private buildPopulateOptions(detailed: boolean = false) {
    const classFields = detailed ? this.POPULATE_FIELDS.classDetailed : this.POPULATE_FIELDS.classBasic;

    return [
      { path: 'classId', select: classFields },
      { path: 'subjectId', select: this.POPULATE_FIELDS.subjectBasic },
      { path: 'teacherId', select: detailed ? this.POPULATE_FIELDS.teacherDetailed : this.POPULATE_FIELDS.teacherBasic },
      {
        path: 'preparation',
        populate: [
          { path: 'subject', select: 'subjectName subjectCode' },
          { path: 'submittedBy', select: 'name email' }
        ]
      },
    ];
  }

  // Input validation methods
  private validateCreateInput(createLectureDto: CreateLectureDto): void {
    // Ensure day of week is valid enum value (already lowercase in enum)
    if (createLectureDto.dayOfWeek && typeof createLectureDto.dayOfWeek === 'string') {
      createLectureDto.dayOfWeek = createLectureDto.dayOfWeek.toLowerCase() as any;
    }

    if (!createLectureDto.classId || !createLectureDto.subjectId || !createLectureDto.teacherId) {
      throw new BadRequestException('معرف الفصل ومعرف المادة ومعرف المدرس مطلوبة');
    }

    if (!createLectureDto.dayOfWeek || createLectureDto.slot === undefined || createLectureDto.slot === null) {
      throw new BadRequestException('يوم الأسبوع والحصة مطلوبة');
    }
  }

  private validateUpdateInput(updateLectureDto: UpdateLectureDto): void {
    // Ensure day of week is valid enum value (already lowercase in enum)
    if (updateLectureDto.dayOfWeek && typeof updateLectureDto.dayOfWeek === 'string') {
      updateLectureDto.dayOfWeek = updateLectureDto.dayOfWeek.toLowerCase() as any;
    }
  }

  private async validateRequiredIds(classId: string, subjectId: string, teacherId: string): Promise<void> {
    const errors = await this.verifyEntityExistence(classId, subjectId, teacherId);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(', '));
    }
  }

  private async verifyEntityExistence(
    classId: string,
    subjectId: string,
    teacherId: string,
  ): Promise<string[]> {
    const errors: string[] = [];

    const classExists = await this.classModel.findById(classId);
    if (!classExists) {
      errors.push(`الفصل ذو المعرف ${classId} غير موجود`);
    }

    const subjectExists = await this.subjectModel.findById(subjectId);
    if (!subjectExists) {
      errors.push(`المادة ذات المعرف ${subjectId} غير موجودة`);
    }

    const teacherExists = await this.teacherModel.findById(teacherId);
    if (!teacherExists) {
      errors.push(`المدرس ذو المعرف ${teacherId} غير موجود`);
    }

    return errors;
  }

  private async verifyBusinessLogic(
    classId: string,
    subjectId: string,
    teacherId: string,
  ) {
    const classData = await this.classModel.findById(classId);
    const teacherData = await this.teacherModel.findById(teacherId);

    // Check if subject is assigned to the class
    const subjectInClass = classData.subjectIds.some(
      (id) => id.toString() === subjectId,
    );
    if (!subjectInClass) {
      throw new BadRequestException(
        'المادة غير مسندة لهذا الفصل. يرجى إسناد المادة للفصل أولاً.',
      );
    }

    // Check if teacher teaches this subject
    const teacherTeachesSubject = teacherData.subjectIds.some(
      (id) => id.toString() === subjectId,
    );
    if (!teacherTeachesSubject) {
      throw new BadRequestException(
        'المدرس لا يدرس هذه المادة. يرجى إسناد المادة للمدرس أولاً.',
      );
    }

    // Check if teacher is active
    if (!teacherData.isActive) {
      throw new BadRequestException('المدرس غير نشط');
    }

    // Check if class is active
    if (!classData.isActive) {
      throw new BadRequestException('الفصل غير نشط');
    }
  }

  private async checkConflicts(
    classId: string,
    teacherId: string,
    dayOfWeek: any,
    slot: number,
    excludeLectureId?: string,
  ) {
    const conflictQuery: any = {
      dayOfWeek,
      slot,
    };

    if (excludeLectureId) {
      conflictQuery._id = { $ne: excludeLectureId };
    }

    // Check class conflict
    const classConflict = await this.lectureModel
      .findOne({ ...conflictQuery, classId })
      .populate('subjectId', 'subjectName subjectCode')
      .populate('classId', 'roomNumber academicYear')
      .populate('teacherId', 'name')
      .exec();

    if (classConflict) {
      const existingSubject = `${classConflict['subjectId']['subjectName']} (${classConflict['subjectId']['subjectCode']})`;
      const teacherName = classConflict['teacherId']['name'];
      const roomNumber = classConflict['classId']['roomNumber'];
      const academicYear = classConflict['classId']['academicYear'];
      throw new ConflictException(
        `Class conflict detected: Room ${roomNumber} (${academicYear}) already has ${existingSubject} scheduled with teacher ${teacherName} at ${dayOfWeek} Slot ${slot}. Lecture ID: ${classConflict._id}`,
      );
    }

    // Check teacher conflict
    const teacherConflict = await this.lectureModel
      .findOne({ ...conflictQuery, teacherId })
      .populate('classId', 'academicYear roomNumber')
      .populate('subjectId', 'subjectName subjectCode')
      .populate('teacherId', 'name')
      .exec();

    if (teacherConflict) {
      const existingSubject = `${teacherConflict['subjectId']['subjectName']} (${teacherConflict['subjectId']['subjectCode']})`;
      const teacherName = teacherConflict['teacherId']['name'];
      const roomNumber = teacherConflict['classId']['roomNumber'];
      const academicYear = teacherConflict['classId']['academicYear'];
      throw new ConflictException(
        `Teacher conflict detected: ${teacherName} already has ${existingSubject} scheduled in Room ${roomNumber} (${academicYear}) at ${dayOfWeek} Slot ${slot}. Lecture ID: ${teacherConflict._id}`,
      );
    }

    // Check room conflict
    const currentClass = await this.classModel.findById(classId);
    if (currentClass && currentClass.roomNumber) {
      const roomConflict = await this.lectureModel
        .findOne({
          ...conflictQuery,
          _id: { $ne: excludeLectureId || null },
        })
        .populate('classId', 'roomNumber academicYear')
        .populate('subjectId', 'subjectName subjectCode')
        .exec();

      if (roomConflict && roomConflict['classId']['roomNumber'] === currentClass.roomNumber) {
        // Make sure it's not the same class (already checked above)
        if (roomConflict.classId.toString() !== classId) {
          // Populate teacher info for room conflict
          await roomConflict.populate('teacherId', 'name');
          const existingSubject = `${roomConflict['subjectId']['subjectName']} (${roomConflict['subjectId']['subjectCode']})`;
          const teacherName = roomConflict['teacherId']['name'];
          const academicYear = roomConflict['classId']['academicYear'];
          throw new ConflictException(
            `Room conflict detected: Room ${currentClass.roomNumber} is already occupied by ${existingSubject} with teacher ${teacherName} (${academicYear}) at ${dayOfWeek} Slot ${slot}. Lecture ID: ${roomConflict._id}`,
          );
        }
      }
    }
  }
}
