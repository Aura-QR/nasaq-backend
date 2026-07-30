import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AcademicYear } from './schemas/academic-year.schema';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectModel(AcademicYear.name) private readonly academicYearModel: Model<AcademicYear>,
  ) {}

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
