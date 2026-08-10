import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { InstallmentPlan } from './schemas/installment-plan.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { Discount } from './schemas/discount.schema';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';

@Injectable()
export class InstallmentPlanService {
  constructor(
    @InjectModel(InstallmentPlan.name) private planModel: Model<InstallmentPlan>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
  ) {}

  private validateObjectId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }
  }

  async create(dto: CreateInstallmentPlanDto, adminId: string) {
    if (dto.dueDates.length !== dto.numberOfInstallments) {
      throw new BadRequestException(
        `عدد تواريخ الاستحقاق (${dto.dueDates.length}) يجب أن يساوي عدد الأقساط (${dto.numberOfInstallments})`,
      );
    }
    if (dto.linkedDiscountId) {
      this.validateObjectId(dto.linkedDiscountId);
      const discount = await this.discountModel.findById(dto.linkedDiscountId).exec();
      if (!discount) throw new NotFoundException('الخصم المرتبط غير موجود');
    }
    if (dto.isDefault) {
      await this.planModel.updateMany({}, { isDefault: false }).exec();
    }
    const data = await this.planModel.create({ ...dto, createdBy: adminId });
    return { message: 'تم إنشاء خطة التقسيط بنجاح', data };
  }

  async find() {
    const data = await this.planModel.find().populate('linkedDiscountId', 'name percentage isActive').sort({ createdAt: -1 }).exec();
    return { message: 'تم استرجاع خطط التقسيط بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id);
    const data = await this.planModel.findById(id).populate('linkedDiscountId', 'name percentage isActive').exec();
    if (!data) throw new NotFoundException('خطة التقسيط غير موجودة');
    return { message: 'تم استرجاع خطة التقسيط بنجاح', data };
  }

  async update(id: string, dto: UpdateInstallmentPlanDto) {
    this.validateObjectId(id);
    const plan = await this.planModel.findById(id).exec();
    if (!plan) throw new NotFoundException('خطة التقسيط غير موجودة');

    if (dto.linkedDiscountId) {
      this.validateObjectId(dto.linkedDiscountId);
      const discount = await this.discountModel.findById(dto.linkedDiscountId).exec();
      if (!discount) throw new NotFoundException('الخصم المرتبط غير موجود');
    }

    const newCount = dto.numberOfInstallments ?? plan.numberOfInstallments;
    const newDates = dto.dueDates ?? plan.dueDates.map(d => d.toISOString());
    if (newDates.length !== newCount) {
      throw new BadRequestException(
        `عدد تواريخ الاستحقاق (${newDates.length}) يجب أن يساوي عدد الأقساط (${newCount})`,
      );
    }
    if (dto.isDefault === true) {
      await this.planModel.updateMany({ _id: { $ne: id } }, { isDefault: false }).exec();
    }
    Object.assign(plan, dto);
    await plan.save();
    return { message: 'تم تحديث خطة التقسيط بنجاح', data: plan };
  }

  async setDefault(id: string) {
    this.validateObjectId(id);
    const exists = await this.planModel.exists({ _id: id });
    if (!exists) throw new NotFoundException('خطة التقسيط غير موجودة');

    await this.planModel.updateMany({ _id: { $ne: id } }, { isDefault: false }).exec();
    const plan = await this.planModel
      .findByIdAndUpdate(id, { isDefault: true }, { new: true })
      .exec();

    return { message: 'تم تعيين الخطة الافتراضية بنجاح', data: plan };
  }

  async delete(id: string) {
    this.validateObjectId(id);
    const planId = new mongoose.Types.ObjectId(id);
    const inUse = await this.recordModel.findOne({
      $or: [
        { installmentPlanId: planId },
        { 'bus.installmentPlanId': planId },
        { 'trips.installmentPlanId': planId },
      ],
    }).exec();
    if (inUse) throw new BadRequestException('لا يمكن الحذف — خطة التقسيط مستخدمة في سجلات طلاب');
    const data = await this.planModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('خطة التقسيط غير موجودة');
    return { message: 'تم حذف خطة التقسيط بنجاح' };
  }
}
