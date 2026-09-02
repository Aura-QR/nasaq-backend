import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AcademicYear } from './schemas/academic-year.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Class } from '../classes/schemas/class.schema';
import { Term } from '../terms/schemas/term.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectModel(AcademicYear.name) private readonly academicYearModel: Model<AcademicYear>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
  ) {}

  /**
   * Removes a year created by mistake.
   *
   * A year is the root of everything a school does, so this refuses far more
   * than it allows. It exists because the alternative — the one that actually
   * happened — is someone editing the production database by hand, which has
   * no guards at all.
   *
   * Refuses outright when a single student is enrolled: that is real work, and
   * no convenience is worth deleting it on a wrong click. Empty classes and
   * their lectures go with the year, because leaving them behind pointing at
   * nothing is how orphans accumulate.
   */
  async remove(id: string) {
    const year = await this.academicYearModel.findById(id).exec();
    if (!year) {
      throw new NotFoundException(`السنة الدراسية ${id} غير موجودة`);
    }

    const enrollments = await this.enrollmentModel
      .countDocuments({ academicYearId: year._id })
      .exec();
    if (enrollments > 0) {
      throw new ConflictException(
        `لا يمكن حذف السنة: بها ${enrollments} تسجيل طالب. ` +
          'أرشفها بدلاً من حذفها.',
      );
    }

    const classes = await this.classModel
      .find({ academicYearId: year._id })
      .select('_id name')
      .lean()
      .exec();

    // A class with students in it is real work too, even when the year-level
    // enrollment rows are gone.
    for (const klass of classes as any[]) {
      const inClass = await this.enrollmentModel
        .countDocuments({ classId: klass._id })
        .exec();
      if (inClass > 0) {
        throw new ConflictException(
          `لا يمكن حذف السنة: الفصل "${klass.name}" به ${inClass} طالب.`,
        );
      }
    }

    const remaining = await this.academicYearModel
      .find({ _id: { $ne: year._id } })
      .sort({ createdAt: -1 })
      .exec();
    if (remaining.length === 0) {
      throw new BadRequestException(
        'لا يمكن حذف السنة الوحيدة في المدرسة — أنشئ سنة أخرى أولاً.',
      );
    }

    const classIds = (classes as any[]).map((c) => c._id);
    const lectures = classIds.length
      ? await this.lectureModel.deleteMany({ classId: { $in: classIds } }).exec()
      : { deletedCount: 0 };
    const removedClasses = classIds.length
      ? await this.classModel.deleteMany({ _id: { $in: classIds } }).exec()
      : { deletedCount: 0 };
    const removedTerms = await this.termModel
      .deleteMany({ academicYearId: year._id })
      .exec();

    await this.academicYearModel.deleteOne({ _id: year._id }).exec();

    // A school with no active year has screens that simply fail, so the most
    // recent survivor takes over rather than leaving that hole.
    let promoted: any = null;
    if (year.status === 'active') {
      promoted = remaining[0];
      promoted.status = 'active';
      await promoted.save();
    }

    return {
      message: `تم حذف السنة الدراسية "${year.name}"`,
      deleted: {
        academicYear: year.name,
        classes: removedClasses.deletedCount ?? 0,
        lectures: lectures.deletedCount ?? 0,
        terms: removedTerms.deletedCount ?? 0,
      },
      activeYear: promoted
        ? { _id: promoted._id, name: promoted.name, note: 'أصبحت السنة النشطة' }
        : null,
    };
  }

  async create(createAcademicYearDto: CreateAcademicYearDto) {
    const existingYear = await this.academicYearModel.findOne({ name: createAcademicYearDto.name }).exec();
    if (existingYear) {
      throw new ConflictException(`Academic year with name ${createAcademicYearDto.name} already exists`);
    }

    // Archive active years
    await this.academicYearModel.updateMany({ status: 'active' }, { $set: { status: 'archived' } }).exec();

    const newYear = new this.academicYearModel({
      ...createAcademicYearDto,
      status: 'active',
      setupStep: 0,
    });

    return newYear.save();
  }

  async findAll() {
    return this.academicYearModel.find().sort({ createdAt: -1 }).exec();
  }

  async findActive() {
    const activeYear = await this.academicYearModel.findOne({ status: 'active' }).exec();
    if (!activeYear) {
      throw new NotFoundException('Active academic year not found');
    }
    return activeYear;
  }

  async findOne(id: string) {
    const year = await this.academicYearModel.findById(id).exec();
    if (!year) {
      throw new NotFoundException(`Academic year with ID ${id} not found`);
    }
    return year;
  }

  async update(id: string, updateAcademicYearDto: UpdateAcademicYearDto) {
    const updatedYear = await this.academicYearModel
      .findByIdAndUpdate(id, updateAcademicYearDto, { new: true })
      .exec();

    if (!updatedYear) {
      throw new NotFoundException(`Academic year with ID ${id} not found`);
    }
    return updatedYear;
  }

  async updateSetupStep(id: string, step: number) {
    const updatedYear = await this.academicYearModel
      .findByIdAndUpdate(id, { $set: { setupStep: step } }, { new: true })
      .exec();

    if (!updatedYear) {
      throw new NotFoundException(`Academic year with ID ${id} not found`);
    }
    return updatedYear;
  }
}
