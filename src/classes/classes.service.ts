import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { Class } from './schemas/class.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Term } from '../terms/schemas/term.schema';
import { GenderEnum } from './enums/gender.enum';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';

@Injectable()
export class ClassesService {
  constructor(
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Term.name)
    private readonly termModel: Model<Term>,
  ) {}

  /**
   * The classes this teacher actually teaches, derived from their timetable —
   * every class they have at least one lecture for.
   *
   * This is deliberately NOT the same as `teacherInChargeId`, which is the
   * form-teacher relationship: a maths teacher may teach six classes and be in
   * charge of one, or of none.
   *
   * Defaults to the active term, matching GET /lectures/teacher/me, so the two
   * agree with each other. When no term is active it falls back to every term
   * rather than returning nothing.
   */
  async findMyTeacherClasses(teacherId: string, termId?: string) {
    this.validateObjectId(teacherId, 'teacher');

    const filter: any = { teacherId: new mongoose.Types.ObjectId(teacherId) };

    const resolvedTermId = termId ?? (await this.getActiveTermId());
    if (resolvedTermId) {
      this.validateObjectId(resolvedTermId, 'term');
      filter.termId = new mongoose.Types.ObjectId(resolvedTermId);
    }

    const classIds = await this.lectureModel.distinct('classId', filter);

    if (!classIds.length) {
      return { message: 'لا توجد فصول مسندة لهذا المعلم', total: 0, data: [] };
    }

    const classes = await this.classModel
      .find({ _id: { $in: classIds } })
      .populate('gradeLevelId', 'name order')
      .populate('academicYearId', 'name status')
      .sort({ name: 1 })
      .exec();

    return {
      message: 'تم استرجاع فصول المعلم بنجاح',
      total: classes.length,
      data: classes,
    };
  }

  private async getActiveTermId(): Promise<string | undefined> {
    const activeTerm = await this.termModel
      .findOne({ status: 'active' })
      .select('_id')
      .exec();
    return activeTerm ? activeTerm._id.toString() : undefined;
  }

  private validateObjectId(id: string, entityName: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة معرف ${entityName} غير صحيحة`);
    }
  }

  private normalizeGender(gender: string): GenderEnum {
    return (gender?.toLowerCase() as GenderEnum) || GenderEnum.BOTH;
  }

  async create(createClassDto: CreateClassDto) {
    createClassDto.gender = this.normalizeGender(createClassDto.gender);

    const existingClass = await this.classModel.findOne({
      academicYearId: new mongoose.Types.ObjectId(createClassDto.academicYearId),
      name: createClassDto.name,
    }).exec();

    if (existingClass) {
      throw new ConflictException(
        `فصل باسم "${createClassDto.name}" موجود بالفعل في هذا العام الدراسي`,
      );
    }

    if (createClassDto.teacherInChargeId) {
      this.validateObjectId(createClassDto.teacherInChargeId, 'teacher');
    }

    const newClass = new this.classModel({
      ...createClassDto,
      gradeLevelId: new mongoose.Types.ObjectId(createClassDto.gradeLevelId),
      academicYearId: new mongoose.Types.ObjectId(createClassDto.academicYearId),
      teacherInChargeId: createClassDto.teacherInChargeId
        ? new mongoose.Types.ObjectId(createClassDto.teacherInChargeId)
        : null,
    });

    await newClass.save();

    return this.findOne(newClass._id.toString());
  }

  async findAll(academicYearId?: string, gradeLevelId?: string) {
    const filter: any = {};
    if (academicYearId) {
      filter.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }
    if (gradeLevelId) {
      filter.gradeLevelId = new mongoose.Types.ObjectId(gradeLevelId);
    }

    return this.classModel
      .find(filter)
      .populate('gradeLevelId', 'name order stageId')
      .populate('academicYearId', 'name status')
      .populate('teacherInChargeId', 'name email phoneNumber')
      .sort({ createdAt: -1 })
      .exec();
  }

  async list(academicYearId?: string) {
    const filter: any = {};
    if (academicYearId) {
      filter.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }

    const classes = await this.classModel
      .find(filter)
      .select('name gradeLevelId academicYearId gender roomNumber maxCapacity isActive')
      .sort({ name: 1 })
      .exec();

    return classes.map((cls) => ({
      id: cls._id,
      name: cls.name,
      gradeLevelId: cls.gradeLevelId,
      academicYearId: cls.academicYearId,
      gender: cls.gender,
      roomNumber: cls.roomNumber,
      maxCapacity: cls.maxCapacity,
      isActive: cls.isActive,
    }));
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'class');

    const classData = await this.classModel
      .findById(id)
      .populate('gradeLevelId', 'name order stageId')
      .populate('academicYearId', 'name status')
      .populate('teacherInChargeId', 'name email phoneNumber')
      .exec();

    if (!classData) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }

    return classData;
  }

  async update(id: string, updateClassDto: UpdateClassDto) {
    this.validateObjectId(id, 'class');

    const currentClass = await this.classModel.findById(id).exec();
    if (!currentClass) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }

    const updateObj: any = { ...updateClassDto };
    if (updateClassDto.gradeLevelId) {
      updateObj.gradeLevelId = new mongoose.Types.ObjectId(updateClassDto.gradeLevelId);
    }
    if (updateClassDto.academicYearId) {
      updateObj.academicYearId = new mongoose.Types.ObjectId(updateClassDto.academicYearId);
    }
    if (updateClassDto.teacherInChargeId) {
      updateObj.teacherInChargeId = new mongoose.Types.ObjectId(updateClassDto.teacherInChargeId);
    }

    const updatedClass = await this.classModel
      .findByIdAndUpdate(id, updateObj, { new: true })
      .populate('gradeLevelId', 'name order stageId')
      .populate('academicYearId', 'name status')
      .populate('teacherInChargeId', 'name email phoneNumber')
      .exec();

    return updatedClass;
  }

  async toggleActive(id: string) {
    this.validateObjectId(id, 'class');

    const classData = await this.classModel.findById(id).exec();
    if (!classData) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }

    classData.isActive = !classData.isActive;
    await classData.save();

    return classData;
  }

  async remove(id: string) {
    this.validateObjectId(id, 'class');

    const deletedClass = await this.classModel.findByIdAndDelete(id).exec();
    if (!deletedClass) {
      throw new NotFoundException(`الفصل بمعرف ${id} غير موجود`);
    }
    return deletedClass;
  }

  /**
   * Wizard Step 4 — Copy classes from previous academic year
   */
  async copyClassesFromYear(targetYearId: string, sourceYearId: string) {
    const sourceClasses = await this.classModel
      .find({ academicYearId: new mongoose.Types.ObjectId(sourceYearId) })
      .exec();

    if (sourceClasses.length === 0) {
      throw new NotFoundException('No classes found in the source academic year');
    }

    const existingTargetClasses = await this.classModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetYearId) })
      .exec();

    if (existingTargetClasses.length > 0) {
      throw new ConflictException(
        'Target academic year already has classes. Delete them first or add manually.',
      );
    }

    const newClassDocs = sourceClasses.map((sourceClass) => ({
      name: sourceClass.name,
      gradeLevelId: sourceClass.gradeLevelId,
      academicYearId: new mongoose.Types.ObjectId(targetYearId),
      gender: sourceClass.gender,
      roomNumber: sourceClass.roomNumber,
      maxCapacity: sourceClass.maxCapacity,
      isActive: true,
    }));

    const created = await this.classModel.insertMany(newClassDocs);

    return {
      message: `${created.length} classes copied successfully`,
      createdCount: created.length,
      classes: created,
    };
  }
}
