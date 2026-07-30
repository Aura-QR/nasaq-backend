import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { GradeLevel } from './schemas/grade-level.schema';
import { Stage } from '../stages/schemas/stage.schema';
import { CreateGradeLevelDto } from './dto/create-grade-level.dto';
import { UpdateGradeLevelDto } from './dto/update-grade-level.dto';

@Injectable()
export class GradeLevelsService {
  constructor(
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevel>,
    @InjectModel(Stage.name) private readonly stageModel: Model<Stage>,
  ) {}

  async create(createGradeLevelDto: CreateGradeLevelDto) {
    const stage = await this.stageModel.findById(createGradeLevelDto.stageId).exec();
    if (!stage) {
      throw new NotFoundException('Stage not found');
    }

    const existing = await this.gradeLevelModel.findOne({
      name: createGradeLevelDto.name,
    }).exec();

    if (existing) {
      throw new ConflictException(
        `Grade level with name "${createGradeLevelDto.name}" already exists`,
      );
    }

    const gradeLevel = new this.gradeLevelModel(createGradeLevelDto);
    return gradeLevel.save();
  }

  async findAll(stageId?: string) {
    const filter: any = {};
    if (stageId) {
      filter.stageId = new mongoose.Types.ObjectId(stageId);
    }
    return this.gradeLevelModel.find(filter).sort({ order: 1 }).exec();
  }

  async findOne(id: string) {
    const gradeLevel = await this.gradeLevelModel.findById(id).exec();
    if (!gradeLevel) {
      throw new NotFoundException(`Grade level with ID ${id} not found`);
    }
    return gradeLevel;
  }

  async findByStage(stageId: string) {
    return this.gradeLevelModel
      .find({ stageId: new mongoose.Types.ObjectId(stageId) })
      .sort({ order: 1 })
      .exec();
  }

  async findNextGradeLevel(currentOrder: number) {
    const nextGrade = await this.gradeLevelModel
      .findOne({ order: { $gt: currentOrder } })
      .sort({ order: 1 })
      .exec();

    return nextGrade || null;
  }

  async update(id: string, updateGradeLevelDto: UpdateGradeLevelDto) {
    if (updateGradeLevelDto.stageId) {
      const stage = await this.stageModel.findById(updateGradeLevelDto.stageId).exec();
      if (!stage) {
        throw new NotFoundException('Stage not found');
      }
    }

    const updatedGradeLevel = await this.gradeLevelModel
      .findByIdAndUpdate(id, updateGradeLevelDto, { new: true })
      .exec();

    if (!updatedGradeLevel) {
      throw new NotFoundException(`Grade level with ID ${id} not found`);
    }
    return updatedGradeLevel;
  }

  async remove(id: string) {
    // TODO: Check for referencing Classes before allowing deletion
    const deletedGradeLevel = await this.gradeLevelModel.findByIdAndDelete(id).exec();
    if (!deletedGradeLevel) {
      throw new NotFoundException(`Grade level with ID ${id} not found`);
    }
    return deletedGradeLevel;
  }
}
