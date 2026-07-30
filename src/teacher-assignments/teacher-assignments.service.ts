import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { TeacherAssignment } from './schemas/teacher-assignment.schema';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';

@Injectable()
export class TeacherAssignmentsService {
  constructor(
    @InjectModel(TeacherAssignment.name)
    private readonly teacherAssignmentModel: Model<TeacherAssignment>,
  ) {}

  async create(dto: CreateTeacherAssignmentDto) {
    const existing = await this.teacherAssignmentModel.findOne({
      teacherId: new mongoose.Types.ObjectId(dto.teacherId),
      subjectOfferingId: new mongoose.Types.ObjectId(dto.subjectOfferingId),
    }).exec();

    if (existing) {
      throw new ConflictException('Teacher is already assigned to this subject offering');
    }

    const assignment = new this.teacherAssignmentModel({
      teacherId: new mongoose.Types.ObjectId(dto.teacherId),
      subjectOfferingId: new mongoose.Types.ObjectId(dto.subjectOfferingId),
    });

    return assignment.save();
  }

  async findByOffering(subjectOfferingId: string) {
    return this.teacherAssignmentModel
      .find({ subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId) })
      .populate('teacherId', 'name email phoneNumber')
      .populate('subjectOfferingId')
      .exec();
  }

  async findByTeacher(teacherId: string) {
    return this.teacherAssignmentModel
      .find({ teacherId: new mongoose.Types.ObjectId(teacherId) })
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
          { path: 'termId', select: 'name order status' },
        ],
      })
      .exec();
  }

  async remove(id: string) {
    const deleted = await this.teacherAssignmentModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Teacher assignment with ID ${id} not found`);
    }
    return deleted;
  }
}
