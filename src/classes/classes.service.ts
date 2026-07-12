import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { Class } from './schemas/class.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Student } from '../students/schemas/student.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { GradesCriteria } from '../grades-criteria/schemas/grades-criteria.schema';
import { GenderEnum } from './enums/gender.enum';
import { transformClassResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { FinancialRecordService } from '../financial/financial-record.service';

@Injectable()
export class ClassesService {
  // Population configurations as constants
  private readonly POPULATE_CONFIG = {
    subjects: { path: 'subjectIds', select: 'subjectName' },
    subjectsWithHours: { path: 'subjectIds', select: 'subjectName weeklyHours' },
    students: { path: 'studentIds', select: '_id firstName fatherName familyName email academicYear' },
    teacher: { path: 'teacherInChargeId', select: 'name email phoneNumber isInCharge' },
  };

  constructor(
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<Subject>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(GradesCriteria.name)
    private readonly gradesCriteriaModel: Model<GradesCriteria>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  // ==================== HELPER METHODS ====================

  /**
   * Validates if a given ID is a valid MongoDB ObjectId
   */
  private validateObjectId(id: string, entityName: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة معرف ${entityName} غير صحيحة`);
    }
  }

  /**
   * Validates multiple ObjectIds
   */
  private validateObjectIds(ids: string[], entityName: string): void {
    const invalidIds = ids.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      throw new BadRequestException(`معرفات ${entityName} غير صحيحة: ${invalidIds.join(', ')}`);
    }
  }

  /**
   * Normalizes gender value to lowercase
   */
  private normalizeGender(gender: string): string {
    return gender?.toLowerCase();
  }

  /**
   * Populates class document with standard relations
   */
  private async populateClass(classDoc: any, includeWeeklyHours = false): Promise<any> {
    const subjectPopulate = includeWeeklyHours 
      ? this.POPULATE_CONFIG.subjectsWithHours 
      : this.POPULATE_CONFIG.subjects;

    return classDoc.populate([
      subjectPopulate,
      this.POPULATE_CONFIG.students,
      this.POPULATE_CONFIG.teacher,
    ]);
  }

  /**
   * Finds a class by ID or throws NotFoundException
   */
  private async findClassByIdOrFail(id: string): Promise<Class> {
    this.validateObjectId(id, 'class');
    const classData = await this.classModel.findById(id).exec();
    
    if (!classData) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }
    
    return classData;
  }

  /**
   * Validates subjects existence
   */
  private async validateSubjects(subjectIds: string[]): Promise<void> {
    if (!subjectIds || subjectIds.length === 0) return;

    const subjects = await this.subjectModel.find({
      _id: { $in: subjectIds },
    });

    if (subjects.length !== subjectIds.length) {
      throw new NotFoundException('واحدة أو أكثر من المواد غير موجودة أو توجد مواد مكررة');
    }
  }

  /**
   * Validates students existence
   */
  private async validateStudents(studentIds: string[]): Promise<Student[]> {
    if (!studentIds || studentIds.length === 0) return [];

    const students = await this.studentModel.find({
      _id: { $in: studentIds },
    });

    if (students.length !== studentIds.length) {
      throw new NotFoundException('واحد أو أكثر من الطلاب غير موجود');
    }

    return students;
  }

  /**
   * Checks for duplicate class
   */
  private async checkDuplicateClass(
    academicYear: string,
    gender: string,
    roomNumber: string,
    excludeId?: string
  ): Promise<void> {
    const query: any = {
      academicYear,
      gender: this.normalizeGender(gender),
      roomNumber,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingClass = await this.classModel.findOne(query);

    if (existingClass) {
      throw new BadRequestException(
        `فصل بالعام الدراسي "${academicYear}" والجنس "${gender}" ورقم القاعة "${roomNumber}" موجود بالفعل. لا يمكن ${excludeId ? 'التحديث إلى' : 'إنشاء'} فصل مكرر`
      );
    }
  }

  /**
   * Updates teacher in charge status
   */
  private async updateTeacherInCharge(
    teacherId: string,
    oldTeacherId?: string
  ): Promise<void> {
    if (!teacherId) return;

    this.validateObjectId(teacherId, 'teacher');

    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    // Remove old teacher in charge status
    if (oldTeacherId && oldTeacherId !== teacherId) {
      await this.teacherModel.findByIdAndUpdate(oldTeacherId, { isInCharge: false });
    }

    // Set new teacher in charge
    await this.teacherModel.findByIdAndUpdate(teacherId, { isInCharge: true });
  }

  /**
   * Updates subject-class relationships
   */
  private async updateSubjectClassRelations(
    classId: string,
    newSubjectIds: string[],
    oldSubjectIds?: string[]
  ): Promise<void> {
    // Remove old relationships
    if (oldSubjectIds && oldSubjectIds.length > 0) {
      await this.subjectModel.updateMany(
        { _id: { $in: oldSubjectIds } },
        { $pull: { classIds: classId } }
      );
    }

    // Add new relationships
    if (newSubjectIds && newSubjectIds.length > 0) {
      await this.subjectModel.updateMany(
        { _id: { $in: newSubjectIds } },
        { $addToSet: { classIds: classId } }
      );
    }
  }

  /**
   * Validates gender compatibility for students
   */
  private validateStudentGenderCompatibility(
    classGender: string,
    students: Student[]
  ): void {
    if (classGender === GenderEnum.BOTH) return;

    const incompatibleStudents = students.filter(
      student => student.gender !== classGender as GenderEnum
    );

    if (incompatibleStudents.length > 0) {
      const studentNames = incompatibleStudents
        .map(s => `${s.firstName} ${s.familyName} (${s.gender})`)
        .join(', ');
      
      throw new BadRequestException(
        `This class is for ${classGender} students only. Incompatible students: ${studentNames}`
      );
    }
  }

  /**
   * Checks if students are enrolled in other classes
   */
  private async checkStudentsInOtherClasses(
    studentIds: string[],
    currentClassId: string
  ): Promise<void> {
    const studentsInOtherClasses = await this.classModel
      .find({
        studentIds: { $in: studentIds },
        _id: { $ne: currentClassId }
      })
      .select('academicYear gender roomNumber studentIds');

    if (studentsInOtherClasses.length > 0) {
      const conflictDetails = studentsInOtherClasses.map(cls => {
        const conflictingStudentIds = studentIds.filter(sid =>
          cls.studentIds.some(csId => csId.toString() === sid)
        );
        return `Students ${conflictingStudentIds.join(', ')} in class (Year: ${cls.academicYear}, Gender: ${cls.gender}, Room: ${cls.roomNumber})`;
      }).join('; ');

      throw new BadRequestException(
        `واحد أو أكثر من الطلاب مسجلون بالفعل في فصول أخرى. ${conflictDetails}. يرجى إزالتهم من تلك الفصول أولاً`
      );
    }
  }

  /**
   * Updates student-class relationships
   */
  private async updateStudentClassRelations(
    studentIds: string[],
    classId: string,
    operation: 'add' | 'remove'
  ): Promise<void> {
    if (!studentIds || studentIds.length === 0) return;

    if (operation === 'add') {
      await this.studentModel.updateMany(
        { _id: { $in: studentIds } },
        { classId: classId }
      );
    } else {
      await this.studentModel.updateMany(
        { _id: { $in: studentIds } },
        { $unset: { classId: '' } }
      );
    }
  }

  /**
   * Builds standard class query with population
   */
  private buildClassQuery(query: any = {}, includeWeeklyHours = false) {
    const subjectPopulate = includeWeeklyHours 
      ? this.POPULATE_CONFIG.subjectsWithHours 
      : this.POPULATE_CONFIG.subjects;

    return this.classModel
      .find(query)
      .populate(subjectPopulate.path, subjectPopulate.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select);
  }

  /**
   * Transforms and returns response
   */
  private transformResponse(classDoc: Class | Class[], message: string, additionalData: any = {}) {
    const data = Array.isArray(classDoc)
      ? classDoc.map(doc => transformClassResponse(doc))
      : transformClassResponse(classDoc);

    return {
      message,
      data,
      ...additionalData,
    };
  }

  // ==================== PUBLIC METHODS ====================

  async create(createClassDto: CreateClassDto) {
    // Normalize gender
    createClassDto.gender = this.normalizeGender(createClassDto.gender);

    // Check for duplicate class
    await this.checkDuplicateClass(
      createClassDto.academicYear,
      createClassDto.gender,
      createClassDto.roomNumber
    );

    // Validate subjects
    await this.validateSubjects(createClassDto.subjectIds);

    // Update teacher in charge
    if (createClassDto.teacherInChargeId) {
      await this.updateTeacherInCharge(createClassDto.teacherInChargeId);
    }

    // Create new class
    const newClass = new this.classModel(createClassDto);
    await newClass.save();

    // Update subject-class relations
    await this.updateSubjectClassRelations(newClass._id.toString(), createClassDto.subjectIds);

    // Populate and return
    await this.populateClass(newClass);
    return this.transformResponse(newClass, 'تم إنشاء الفصل بنجاح');
  }

  async findAll() {
    const classes = await this.buildClassQuery()
      .sort({ createdAt: -1 })
      .exec();

    return this.transformResponse(classes, 'تم استرجاع جميع الفصول بنجاح');
  }

  async findActive() {
    const classes = await this.buildClassQuery({ isActive: true }).exec();
    return this.transformResponse(classes, 'تم استرجاع الفصول النشطة بنجاح');
  }

  async findInactive() {
    const classes = await this.buildClassQuery({ isActive: false }).exec();
    return this.transformResponse(classes, 'تم استرجاع الفصول غير النشطة بنجاح');
  }

  async list() {
    const classes = await this.classModel
      .find()
      .select('academicYear gender roomNumber isActive')
      .sort({ createdAt: -1 })
      .exec();

    return classes.map((cls) => ({
      id: cls._id,
      academicYear: cls.academicYear,
      gender: cls.gender,
      roomNumber: cls.roomNumber,
      isActive: cls.isActive,
    }));
  }

  async findBySubject(subjectId: string) {
    this.validateObjectId(subjectId, 'subject');

    const classes = await this.buildClassQuery({
      subjectIds: subjectId,
      isActive: true
    }).exec();

    return this.transformResponse(classes, 'Classes retrieved successfully');
  }

  async getStudentsInClass(classId: string) {
    const classData = await this.findClassByIdOrFail(classId);

    if (!classData.studentIds || classData.studentIds.length === 0) {
      return {
        message: 'لا يوجد طلاب مسجلون في هذا الفصل',
        data: [],
        count: 0,
      };
    }

    const students = await this.studentModel
      .find({ _id: { $in: classData.studentIds } })
      .select('firstName familyName fatherName email phoneNumber academicYear isActive')
      .exec();

    return {
      message: 'تم استرجاع الطلاب بنجاح',
      data: students,
      count: students.length,
    };
  }

  async getMyClass(studentId: string) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    if (!student.classId) {
      return { message: 'الطالب غير مسجل في أي فصل', data: null };
    }

    const classData = await this.classModel
      .findById(student.classId)
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    if (!classData) {
      throw new NotFoundException(`الفصل غير موجود`);
    }

    return {
      message: 'تم استرجاع فصل الطالب بنجاح',
      data: classData,
    };
  }

  async getMyClassMates(studentId: string) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    if (!student.classId) {
      return { message: 'الطالب غير مسجل في أي فصل', data: [] };
    }

    const classData = await this.classModel.findById(student.classId);
    if (!classData || !classData.studentIds?.length) {
      return { message: 'لا يوجد طلاب آخرون في نفس الفصل', data: [], count: 0 };
    }

    const mates = await this.studentModel
      .find({
        _id: { $in: classData.studentIds, $ne: studentId },
      })
      .select('firstName familyName fatherName email schoolEmail academicYear')
      .exec();

    return {
      message: 'تم استرجاع زملاء الفصل بنجاح',
      data: mates,
      count: mates.length,
    };
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'class');

    const classData = await this.classModel
      .findById(id)
      .populate(this.POPULATE_CONFIG.subjectsWithHours.path, this.POPULATE_CONFIG.subjectsWithHours.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    if (!classData) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }

    return this.transformResponse(classData, 'تم استرجاع الفصل بنجاح');
  }

  async update(id: string, updateClassDto: UpdateClassDto) {
    this.validateObjectId(id, 'class');

    // Normalize gender
    if (updateClassDto.gender) {
      updateClassDto.gender = this.normalizeGender(updateClassDto.gender);
    }

    const currentClass = await this.findClassByIdOrFail(id);

    // Check for duplicate class
    if (updateClassDto.academicYear || updateClassDto.gender || updateClassDto.roomNumber) {
      await this.checkDuplicateClass(
        updateClassDto.academicYear || currentClass.academicYear,
        updateClassDto.gender || currentClass.gender,
        updateClassDto.roomNumber || currentClass.roomNumber,
        id
      );
    }

    // Validate subjects
    await this.validateSubjects(updateClassDto.subjectIds);

    // Validate students
    await this.validateStudents(updateClassDto.studentIds);

    // Validate max capacity
    if (updateClassDto.maxCapacity !== undefined) {
      const currentStudentCount = currentClass.studentIds?.length || 0;
      if (updateClassDto.maxCapacity < currentStudentCount) {
        throw new BadRequestException(
          `لا يمكن تقليل السعة القصوى إلى ${updateClassDto.maxCapacity}. عدد الطلاب المسجلين حالياً هو ${currentStudentCount} طالب`
        );
      }
    }

    // Update teacher in charge
    if (updateClassDto.teacherInChargeId !== undefined) {
      if (updateClassDto.teacherInChargeId) {
        await this.updateTeacherInCharge(
          updateClassDto.teacherInChargeId,
          currentClass.teacherInChargeId?.toString()
        );
      } else if (updateClassDto.teacherInChargeId === null && currentClass.teacherInChargeId) {
        await this.teacherModel.findByIdAndUpdate(
          currentClass.teacherInChargeId,
          { isInCharge: false }
        );
      }
    }

    // Update subject-class relations
    if (updateClassDto.subjectIds !== undefined) {
      await this.updateSubjectClassRelations(
        id,
        updateClassDto.subjectIds,
        currentClass.subjectIds?.map(sid => sid.toString())
      );
    }

    // Update class
    const updatedClass = await this.classModel
      .findByIdAndUpdate(id, updateClassDto, { new: true })
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    if (!updatedClass) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }

    return this.transformResponse(updatedClass, 'تم تحديث الفصل بنجاح');
  }

  async addSubject(classId: string, subjectId: string) {
    this.validateObjectId(classId, 'class');
    this.validateObjectId(subjectId, 'subject');

    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`المادة بمعرف ${subjectId} غير موجودة`);
    }

    const classData = await this.findClassByIdOrFail(classId);

    const gradingCriteria = await this.gradesCriteriaModel.findOne({
      subjectId,
      academicYear: classData.academicYear,
    });
    if (!gradingCriteria) {
      throw new BadRequestException(
        `لا يمكن إضافة المادة إلى الفصل لأنه لا توجد معايير تقييم للمادة في العام الدراسي ${classData.academicYear}`,
      );
    }

    await this.subjectModel.findByIdAndUpdate(
      subjectId,
      { $addToSet: { classIds: classId } }
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $addToSet: { subjectIds: subjectId } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم إضافة المادة إلى الفصل بنجاح');
  }

  async removeSubject(classId: string, subjectId: string) {
    this.validateObjectId(classId, 'class');
    this.validateObjectId(subjectId, 'subject');

    await this.findClassByIdOrFail(classId);

    await this.subjectModel.findByIdAndUpdate(
      subjectId,
      { $pull: { classIds: classId } }
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $pull: { subjectIds: subjectId } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم إزالة المادة من الفصل بنجاح');
  }

  async addSubjects(classId: string, subjectIds: string[]) {
    this.validateObjectId(classId, 'class');

    if (!subjectIds || subjectIds.length === 0) {
      throw new BadRequestException('مصفوفة معرفات المواد لا يمكن أن تكون فارغة');
    }

    this.validateObjectIds(subjectIds, 'subject');
    await this.validateSubjects(subjectIds);
    const classData = await this.findClassByIdOrFail(classId);

    const criteriaList = await this.gradesCriteriaModel.find({
      subjectId: { $in: subjectIds },
      academicYear: classData.academicYear,
    });
    const subjectsWithCriteria = new Set(criteriaList.map((c) => c.subjectId.toString()));
    const missingCriteria = subjectIds.filter((id) => !subjectsWithCriteria.has(id));
    if (missingCriteria.length > 0) {
      throw new BadRequestException(
        `لا يمكن إضافة المواد التالية لأنه لا توجد معايير تقييم لها في العام الدراسي ${classData.academicYear}: ${missingCriteria.join(', ')}`,
      );
    }

    await this.updateSubjectClassRelations(classId, subjectIds);

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $addToSet: { subjectIds: { $each: subjectIds } } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(
      updatedClass,
      `${subjectIds.length} subject(s) added to class successfully`
    );
  }

  async removeSubjects(classId: string, subjectIds: string[]) {
    this.validateObjectId(classId, 'class');

    if (!subjectIds || subjectIds.length === 0) {
      throw new BadRequestException('مصفوفة معرفات المواد لا يمكن أن تكون فارغة');
    }

    this.validateObjectIds(subjectIds, 'subject');
    await this.findClassByIdOrFail(classId);

    await this.subjectModel.updateMany(
      { _id: { $in: subjectIds } },
      { $pull: { classIds: classId } }
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $pull: { subjectIds: { $in: subjectIds } } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(
      updatedClass,
      `${subjectIds.length} subject(s) removed from class successfully`
    );
  }

  async setSubjects(classId: string, subjectIds: string[]) {
    this.validateObjectId(classId, 'class');

    if (subjectIds.length > 0) {
      this.validateObjectIds(subjectIds, 'subject');
      await this.validateSubjects(subjectIds);
    }

    const classData = await this.findClassByIdOrFail(classId);

    // Update subject-class relations
    await this.updateSubjectClassRelations(
      classId,
      subjectIds,
      classData.subjectIds?.map(sid => sid.toString())
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { subjectIds: subjectIds },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم تحديث مواد الفصل بنجاح');
  }

  async clearSubjects(classId: string) {
    this.validateObjectId(classId, 'class');

    const classData = await this.findClassByIdOrFail(classId);

    if (classData.subjectIds && classData.subjectIds.length > 0) {
      await this.subjectModel.updateMany(
        { _id: { $in: classData.subjectIds } },
        { $pull: { classIds: classId } }
      );
    }

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { subjectIds: [] },
        { new: true }
      )
      .exec();

    return this.transformResponse(updatedClass, 'تم حذف جميع المواد من الفصل بنجاح');
  }

  async toggleActive(id: string) {
    const classData = await this.findClassByIdOrFail(id);

    classData.isActive = !classData.isActive;
    await classData.save();

    await this.populateClass(classData);

    return this.transformResponse(
      classData,
      `تم ${classData.isActive ? 'تفعيل' : 'إلغاء تفعيل'} الفصل بنجاح`
    );
  }

  async addStudent(classId: string, studentId: string) {
    this.validateObjectId(classId, 'class');
    this.validateObjectId(studentId, 'student');

    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${studentId} غير موجود`);
    }

    const classData = await this.findClassByIdOrFail(classId);

    // Validate gender compatibility
    this.validateStudentGenderCompatibility(classData.gender, [student]);

    // Check if student is in another class
    await this.checkStudentsInOtherClasses([studentId], classId);

    // Update student's classId
    await this.updateStudentClassRelations([studentId], classId, 'add');

    // Auto-create financial record for the student in this class
    await this.financialRecordService.createOrUpdateRecord(studentId, classId);

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $addToSet: { studentIds: studentId } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم إضافة الطالب إلى الفصل بنجاح');
  }

  async removeStudent(classId: string, studentId: string) {
    this.validateObjectId(classId, 'class');
    this.validateObjectId(studentId, 'student');

    await this.findClassByIdOrFail(classId);

    // Remove classId from student's record
    await this.updateStudentClassRelations([studentId], classId, 'remove');

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $pull: { studentIds: studentId } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم إزالة الطالب من الفصل بنجاح');
  }

  async addStudents(classId: string, studentIds: string[]) {
    this.validateObjectId(classId, 'class');

    if (!studentIds || studentIds.length === 0) {
      throw new BadRequestException('مصفوفة معرفات الطلاب لا يمكن أن تكون فارغة');
    }

    this.validateObjectIds(studentIds, 'student');

    const students = await this.validateStudents(studentIds);
    const classData = await this.findClassByIdOrFail(classId);

    // Validate gender compatibility
    this.validateStudentGenderCompatibility(classData.gender, students);

    // Check if students are in other classes
    await this.checkStudentsInOtherClasses(studentIds, classId);

    // Update students' classId field
    await this.updateStudentClassRelations(studentIds, classId, 'add');

    // Auto-create financial records for all added students
    await Promise.all(
      studentIds.map(id => this.financialRecordService.createOrUpdateRecord(id, classId)),
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { $addToSet: { studentIds: { $each: studentIds } } },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(
      updatedClass,
      `${studentIds.length} student(s) added to class successfully`
    );
  }

  async clearStudents(classId: string) {
    this.validateObjectId(classId, 'class');

    const classData = await this.findClassByIdOrFail(classId);

    // Remove classId from all students
    await this.updateStudentClassRelations(
      classData.studentIds?.map(sid => sid.toString()) || [],
      classId,
      'remove'
    );

    const updatedClass = await this.classModel
      .findByIdAndUpdate(
        classId,
        { studentIds: [] },
        { new: true }
      )
      .populate(this.POPULATE_CONFIG.subjects.path, this.POPULATE_CONFIG.subjects.select)
      .populate(this.POPULATE_CONFIG.students.path, this.POPULATE_CONFIG.students.select)
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    return this.transformResponse(updatedClass, 'تم حذف جميع الطلاب من الفصل بنجاح');
  }

  async remove(id: string) {
    const classToDelete = await this.findClassByIdOrFail(id);

    // Check if class is assigned to any lectures
    const assignedLectures = await this.lectureModel.find({ classId: id }).exec();

    if (assignedLectures.length > 0) {
      throw new BadRequestException(
        `لا يمكن حذف الفصل. الفصل لديه ${assignedLectures.length} محاضرة مجدولة. يرجى إزالة جميع المحاضرات المسندة أولاً`
      );
    }

    // Remove class from subjects
    await this.updateSubjectClassRelations(
      id,
      [],
      classToDelete.subjectIds?.map(sid => sid.toString())
    );

    // Remove classId from all students
    await this.updateStudentClassRelations(
      classToDelete.studentIds?.map(sid => sid.toString()) || [],
      id,
      'remove'
    );

    // Update teacher in charge flag
    if (classToDelete.teacherInChargeId) {
      await this.teacherModel.findByIdAndUpdate(
        classToDelete.teacherInChargeId,
        { isInCharge: false }
      );
    }

    const result = await this.classModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف الفصل بنجاح',
      data: result
    };
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};

    const textSearchFields = ['roomNumber'];
    const exactMatchFields = ['academicYear', 'gender'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'isActive') {
        query[key] = stringValue === 'true';
      } else if (key === 'maxCapacity') {
        query[key] = Number(stringValue);
      } else if (key === 'gender') {
        query[key] = { $in: [stringValue.toLowerCase(), 'both'] };
      } else if (key === 'teacherInChargeId' && stringValue === 'null') {
        query[key] = null;
      } else if (key === 'teacherInChargeId') {
        this.validateObjectId(stringValue, 'teacher');
        query[key] = stringValue;
      } else if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (exactMatchFields.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }

    const total = await this.classModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let classesQuery = this.buildClassQuery(query);

    if (isPaginationRequested) {
      classesQuery = classesQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const classes = await classesQuery.sort({ createdAt: -1 }).exec();

    if (isPaginationRequested) {
      return {
        data: classes.map((classDoc) => transformClassResponse(classDoc)),
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages
      };
    }

    return classes.map((classDoc) => transformClassResponse(classDoc));
  }

  /**
   * Get all classes that a teacher teaches with the subjects they teach in each class
   * Based on lectures assigned to the teacher
   */
  async getTeacherClasses(teacherId: string) {
    this.validateObjectId(teacherId, 'teacher');

    // Verify teacher exists
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    // Find all lectures for this teacher
    const lectures = await this.lectureModel
      .find({ teacherId })
      .populate('classId')
      .populate('subjectId', 'subjectName subjectCode')
      .exec();

    if (lectures.length === 0) {
      return {
        message: 'لا توجد فصول لهذا المعلم',
        data: [],
        count: 0,
      };
    }

    // Group lectures by classId
    const classMap = new Map();

    lectures.forEach((lecture: any) => {
      const classId = lecture.classId._id.toString();

      if (!classMap.has(classId)) {
        classMap.set(classId, {
          classInfo: lecture.classId,
          subjects: []
        });
      }

      // Add subject if not already in the list
      const classData = classMap.get(classId);
      const subjectExists = classData.subjects.some(
        (s: any) => s._id.toString() === lecture.subjectId._id.toString()
      );

      if (!subjectExists) {
        classData.subjects.push(lecture.subjectId);
      }
    });

    // Fetch full class details
    const classIds = Array.from(classMap.keys());
    const classes = await this.classModel
      .find({ _id: { $in: classIds } })
      .populate(this.POPULATE_CONFIG.teacher.path, this.POPULATE_CONFIG.teacher.select)
      .exec();

    // Combine class details with subjects the teacher teaches
    const result = classes.map((classDoc: any) => {
      const classId = classDoc._id.toString();
      const classData = classMap.get(classId);

      return {
        id: classDoc._id,
        academicYear: classDoc.academicYear,
        gender: classDoc.gender,
        roomNumber: classDoc.roomNumber,
        teachingSubjects: classData.subjects.map((subject: any) => ({
          _id: subject._id,
          subjectName: subject.subjectName,
          subjectCode: subject.subjectCode
        }))
      };
    });

    return {
      message: 'تم استرجاع فصول المعلم بنجاح',
      data: result,
    };
  }
}
