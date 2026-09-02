import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { TeacherConstraint } from './schemas/teacher-constraint.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { SetTeacherConstraintDto } from './dto/set-teacher-constraint.dto';

@Injectable()
export class TeacherConstraintsService {
  constructor(
    @InjectModel(TeacherConstraint.name)
    private readonly constraintModel: Model<TeacherConstraint>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
  ) {}

  /**
   * Replaces the teacher's constraints for the term wholesale.
   *
   * Whole-set rather than incremental: this is edited as a grid of days, and
   * saving a grid one cell at a time is how a half-applied edit happens.
   */
  async set(dto: SetTeacherConstraintDto) {
    const teacher = await this.teacherModel.findById(dto.teacherId).select('name').lean().exec();
    if (!teacher) throw new NotFoundException('المعلم غير موجود');

    const saved = await this.constraintModel
      .findOneAndUpdate(
        {
          teacherId: new mongoose.Types.ObjectId(dto.teacherId),
          termId: new mongoose.Types.ObjectId(dto.termId),
        },
        {
          teacherId: new mongoose.Types.ObjectId(dto.teacherId),
          termId: new mongoose.Types.ObjectId(dto.termId),
          unavailable: dto.unavailable ?? [],
          note: dto.note ?? '',
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return {
      message: dto.unavailable?.length
        ? `تم حفظ قيود ${(teacher as any).name}`
        : `تم مسح قيود ${(teacher as any).name}`,
      data: saved,
    };
  }

  async listByTerm(termId: string) {
    return this.constraintModel
      .find({ termId: new mongoose.Types.ObjectId(String(termId)) })
      .populate('teacherId', 'name')
      .lean()
      .exec();
  }

  async remove(teacherId: string, termId: string) {
    const res = await this.constraintModel
      .deleteOne({
        teacherId: new mongoose.Types.ObjectId(teacherId),
        termId: new mongoose.Types.ObjectId(termId),
      })
      .exec();
    if (res.deletedCount === 0) throw new NotFoundException('لا توجد قيود لهذا المعلم في هذا الترم');
    return { message: 'تم مسح القيود' };
  }
}
