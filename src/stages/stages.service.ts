import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Stage } from './schemas/stage.schema';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';

@Injectable()
export class StagesService {
  constructor(
    @InjectModel(Stage.name) private readonly stageModel: Model<Stage>,
  ) {}

  async create(createStageDto: CreateStageDto) {
    const existing = await this.stageModel.findOne({ name: createStageDto.name }).exec();
    if (existing) {
      throw new ConflictException(`Stage with name "${createStageDto.name}" already exists`);
    }

    const stage = new this.stageModel(createStageDto);
    return stage.save();
  }

  async findAll() {
    return this.stageModel.find().sort({ order: 1 }).exec();
  }

  async findOne(id: string) {
    const stage = await this.stageModel.findById(id).exec();
    if (!stage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    return stage;
  }

  async update(id: string, updateStageDto: UpdateStageDto) {
    const updatedStage = await this.stageModel
      .findByIdAndUpdate(id, updateStageDto, { new: true })
      .exec();

    if (!updatedStage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    return updatedStage;
  }

  async remove(id: string) {
    // TODO: Check for referencing GradeLevels before allowing deletion
    const deletedStage = await this.stageModel.findByIdAndDelete(id).exec();
    if (!deletedStage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    return deletedStage;
  }
}
