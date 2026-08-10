import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { FeeConfig } from './schemas/fee-config.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { CreateFeeConfigDto } from './dto/create-fee-config.dto';
import { UpdateFeeConfigDto } from './dto/update-fee-config.dto';

import { FinancialRecordService } from './financial-record.service';

@Injectable()
export class FeeConfigService {
  constructor(
    @InjectModel(FeeConfig.name) private feeConfigModel: Model<FeeConfig>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  private validateObjectId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }
  }

  async create(dto: CreateFeeConfigDto, adminId: string) {
    const existing = await this.feeConfigModel.findOne({
      academicYearId: new mongoose.Types.ObjectId(dto.academicYearId),
      gradeLevelId: new mongoose.Types.ObjectId(dto.gradeLevelId),
    });
    if (existing) {
      throw new BadRequestException(`معايير الرسوم موجودة بالفعل لهذا العام الدراسي والمرحلة الدراسية`);
    }
    const data = await this.feeConfigModel.create({ ...dto, createdBy: adminId });
    return { message: 'تم إنشاء معايير الرسوم بنجاح', data };
  }

  async find() {
    const data = await this.feeConfigModel.find().sort({ createdAt: -1 }).populate('gradeLevelId', 'name order').populate('academicYearId', 'name').exec();
    return { message: 'تم استرجاع معايير الرسوم بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id);
    const data = await this.feeConfigModel.findById(id).populate('gradeLevelId', 'name order').populate('academicYearId', 'name').exec();
    if (!data) throw new NotFoundException('معايير الرسوم غير موجودة');
    return { message: 'تم استرجاع معايير الرسوم بنجاح', data };
  }

  async update(id: string, dto: UpdateFeeConfigDto) {
    this.validateObjectId(id);
    if (dto.academicYearId || dto.gradeLevelId) {
      const current = await this.feeConfigModel.findById(id).exec();
      if (!current) throw new NotFoundException('معايير الرسوم غير موجودة');
      const checkYearId = dto.academicYearId ? new mongoose.Types.ObjectId(dto.academicYearId) : current.academicYearId;
      const checkGradeId = dto.gradeLevelId ? new mongoose.Types.ObjectId(dto.gradeLevelId) : current.gradeLevelId;
      const dup = await this.feeConfigModel.findOne({
        academicYearId: checkYearId,
        gradeLevelId: checkGradeId,
        _id: { $ne: id },
      });
      if (dup) throw new BadRequestException(`العام الدراسي والمرحلة الدراسية مستخدمان بالفعل في معايير رسوم أخرى`);
    }
    const data = await this.feeConfigModel
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .exec();
    if (!data) throw new NotFoundException('معايير الرسوم غير موجودة');

    // Propagate fee changes to active student financial records
    await this.financialRecordService.recalculateForFeeConfig(id);

    return { message: 'تم تحديث معايير الرسوم بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id);
    const inUse = await this.recordModel.findOne({ feeConfigId: new mongoose.Types.ObjectId(id) }).exec();
    if (inUse) throw new BadRequestException('لا يمكن الحذف — معايير الرسوم مستخدمة في سجلات طلاب');
    const data = await this.feeConfigModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('معايير الرسوم غير موجودة');
    return { message: 'تم حذف معايير الرسوم بنجاح' };
  }
}
