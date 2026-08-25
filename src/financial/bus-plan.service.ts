import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { BusPlan } from './schemas/bus-plan.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { CreateBusPlanDto } from './dto/create-bus-plan.dto';
import { UpdateBusPlanDto } from './dto/update-bus-plan.dto';

@Injectable()
export class BusPlanService {
  constructor(
    @InjectModel(BusPlan.name) private busPlanModel: Model<BusPlan>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  async create(dto: CreateBusPlanDto) {
    const created = await this.busPlanModel.create({
      name: dto.name,
      description: dto.description,
      serviceType: dto.serviceType,
      fee: dto.fee,
      installmentPlanId: dto.installmentPlanId || null,
      isActive: true,
    });

    return { message: 'تم إنشاء خطة الباص بنجاح', data: created };
  }

  async findAll() {
    const data = await this.busPlanModel
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .exec();

    return { message: 'تم استرجاع خطط الباص بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'خطة الباص');
    const plan = await this.busPlanModel.findById(id).exec();
    if (!plan || !plan.isActive) throw new NotFoundException('خطة الباص غير موجودة');

    const enrolledCount = await this.recordModel.countDocuments({
      'bus.busPlanId': new mongoose.Types.ObjectId(id),
      'bus.enrolled': true,
    });

    return { message: 'تم استرجاع تفاصيل خطة الباص بنجاح', data: { ...plan.toObject(), enrolledCount } };
  }

  async update(id: string, dto: UpdateBusPlanDto) {
    this.validateObjectId(id, 'خطة الباص');
    const data = await this.busPlanModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!data) throw new NotFoundException('خطة الباص غير موجودة');

    return { message: 'تم تحديث خطة الباص بنجاح', data };
  }

  async deactivate(id: string) {
    this.validateObjectId(id, 'خطة الباص');
    const data = await this.busPlanModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .exec();
    if (!data) throw new NotFoundException('خطة الباص غير موجودة');

    return { message: 'تم إلغاء تفعيل خطة الباص بنجاح', data };
  }
}
