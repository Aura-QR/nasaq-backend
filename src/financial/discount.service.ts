import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Discount } from './schemas/discount.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';

@Injectable()
export class DiscountService {
  constructor(
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
  ) {}

  private validateObjectId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }
  }

  private computeDiscountAmount(fee: number, value: number): number {
    return Math.round((fee * value) / 100);
  }

  private redistributeUnpaidInstallments(installments: any[], newBalance: number) {
    const unpaid = installments.filter(i => i.status !== PaymentStatus.PAID);
    const n = unpaid.length;
    if (n === 0) return;

    const base = Math.floor(newBalance / n);
    const remainder = newBalance - base * n;

    unpaid.forEach((inst, index) => {
      inst.amount = index < remainder ? base + 1 : base;
    });
  }

  async create(dto: CreateDiscountDto, adminId: string) {
    if (dto.percentage > 100) {
      throw new BadRequestException('نسبة الخصم لا يمكن أن تتجاوز 100%');
    }
    const data = await this.discountModel.create({ ...dto, createdBy: adminId });
    return { message: 'تم إنشاء الخصم بنجاح', data };
  }

  async find() {
    const data = await this.discountModel.find().sort({ createdAt: -1 }).exec();
    return { message: 'تم استرجاع الخصومات بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id);
    const data = await this.discountModel.findById(id).exec();
    if (!data) throw new NotFoundException('الخصم غير موجود');
    return { message: 'تم استرجاع الخصم بنجاح', data };
  }

  async update(id: string, dto: UpdateDiscountDto) {
    this.validateObjectId(id);
    const data = await this.discountModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    if (!data) throw new NotFoundException('الخصم غير موجود');
    return { message: 'تم تحديث الخصم بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id);
    const inUse = await this.recordModel.findOne({
      $or: [
        { 'tuition.discount.discountId': new mongoose.Types.ObjectId(id) },
        { 'bus.discount.discountId': new mongoose.Types.ObjectId(id) },
        { 'trips.discount.discountId': new mongoose.Types.ObjectId(id) },
      ],
    }).exec();
    if (inUse) throw new BadRequestException('لا يمكن الحذف — الخصم مستخدم في سجلات طلاب');
    const data = await this.discountModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('الخصم غير موجود');
    return { message: 'تم حذف الخصم بنجاح' };
  }

  private async getRecord(studentId: string, academicYearId?: string): Promise<StudentFinancialRecord> {
    this.validateObjectId(studentId);
    const query: any = { studentId: new mongoose.Types.ObjectId(studentId) };
    if (academicYearId) {
      this.validateObjectId(academicYearId);
      query.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }
    const record = await this.recordModel.findOne(query).sort({ createdAt: -1 }).exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');
    return record;
  }

  async applyToTuition(studentId: string, dto: ApplyDiscountDto) {
    const record = await this.getRecord(studentId, dto.academicYearId);

    const discount = await this.discountModel.findById(dto.discountId).exec();
    if (!discount) throw new NotFoundException('الخصم غير موجود');
    if (!discount.isActive) throw new BadRequestException('هذا الخصم غير نشط');

    if (record.tuition.discount) {
      throw new BadRequestException('يوجد خصم مطبق بالفعل على الرسوم الدراسية — قم بإزالته أولاً');
    }

    const grossFee = record.tuition.grossFee || record.tuition.fee;
    const discountAmount = this.computeDiscountAmount(grossFee, discount.percentage);
    const netFee = grossFee - discountAmount;
    const newBalance = netFee - record.tuition.totalPaid;

    record.tuition.discount = {
      discountId: discount._id as mongoose.Types.ObjectId,
      name: discount.name,
      percentage: discount.percentage,
      discountAmount,
    } as any;
    record.tuition.netFee = netFee;
    record.tuition.status = newBalance <= 0 ? FeeStatus.PAID : record.tuition.totalPaid > 0 ? FeeStatus.PARTIAL : FeeStatus.UNPAID;

    this.redistributeUnpaidInstallments(record.tuition.installments, Math.max(newBalance, 0));
    record.markModified('tuition');
    await record.save();

    return { message: 'تم تطبيق الخصم على الرسوم الدراسية بنجاح', data: record.tuition };
  }

  async removeFromTuition(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);

    const grossFee = record.tuition.grossFee || record.tuition.fee;
    record.tuition.discount = null;
    record.tuition.netFee = grossFee;
    const newBalance = grossFee - record.tuition.totalPaid;
    this.redistributeUnpaidInstallments(record.tuition.installments, Math.max(newBalance, 0));
    record.markModified('tuition');
    await record.save();

    return { message: 'تم إزالة الخصم من الرسوم الدراسية بنجاح', data: record.tuition };
  }

  async applyToBus(studentId: string, dto: ApplyDiscountDto) {
    const record = await this.getRecord(studentId, dto.academicYearId);
    if (!record.bus.enrolled) throw new BadRequestException('الطالب غير مسجل في خدمة الحافلة');
    if (record.bus.discount) {
      throw new BadRequestException('يوجد خصم مطبق بالفعل على رسوم الحافلة — قم بإزالته أولاً');
    }

    const discount = await this.discountModel.findById(dto.discountId).exec();
    if (!discount) throw new NotFoundException('الخصم غير موجود');
    if (!discount.isActive) throw new BadRequestException('هذا الخصم غير نشط');

    const discountAmount = this.computeDiscountAmount(record.bus.fee, discount.percentage);
    const netFee = record.bus.fee - discountAmount;
    const newBalance = netFee - record.bus.totalPaid;

    record.bus.discount = {
      discountId: discount._id as mongoose.Types.ObjectId,
      name: discount.name,
      percentage: discount.percentage,
      discountAmount,
    } as any;
    record.bus.netFee = netFee;
    record.bus.status = newBalance <= 0 ? FeeStatus.PAID : record.bus.totalPaid > 0 ? FeeStatus.PARTIAL : FeeStatus.UNPAID;

    this.redistributeUnpaidInstallments(record.bus.installments, Math.max(newBalance, 0));
    record.markModified('bus');
    await record.save();

    return { message: 'تم تطبيق الخصم على رسوم الحافلة بنجاح', data: record.bus };
  }

  async removeFromBus(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);

    record.bus.discount = null;
    record.bus.netFee = record.bus.fee;
    const newBalance = record.bus.fee - record.bus.totalPaid;
    this.redistributeUnpaidInstallments(record.bus.installments, Math.max(newBalance, 0));
    record.markModified('bus');
    await record.save();

    return { message: 'تم إزالة الخصم من رسوم الحافلة بنجاح', data: record.bus };
  }

  async applyToTrip(studentId: string, tripId: string, dto: ApplyDiscountDto) {
    this.validateObjectId(tripId);
    const record = await this.getRecord(studentId, dto.academicYearId);

    const trip = record.trips.find(t => (t as any)._id.toString() === tripId);
    if (!trip) throw new NotFoundException('الرحلة غير موجودة');
    if ((trip as any).discount) {
      throw new BadRequestException('يوجد خصم مطبق بالفعل على هذه الرحلة — قم بإزالته أولاً');
    }

    const discount = await this.discountModel.findById(dto.discountId).exec();
    if (!discount) throw new NotFoundException('الخصم غير موجود');
    if (!discount.isActive) throw new BadRequestException('هذا الخصم غير نشط');

    const discountAmount = this.computeDiscountAmount(trip.fee, discount.percentage);
    const netFee = trip.fee - discountAmount;
    const newBalance = netFee - trip.totalPaid;

    (trip as any).discount = {
      discountId: discount._id as mongoose.Types.ObjectId,
      name: discount.name,
      percentage: discount.percentage,
      discountAmount,
    };
    (trip as any).netFee = netFee;
    trip.status = newBalance <= 0 ? FeeStatus.PAID : trip.totalPaid > 0 ? FeeStatus.PARTIAL : FeeStatus.UNPAID;

    this.redistributeUnpaidInstallments(trip.installments, Math.max(newBalance, 0));
    record.markModified('trips');
    await record.save();

    return { message: 'تم تطبيق الخصم على رسوم الرحلة بنجاح', data: trip };
  }

  async removeFromTrip(studentId: string, tripId: string, academicYearId?: string) {
    this.validateObjectId(tripId);
    const record = await this.getRecord(studentId, academicYearId);

    const trip = record.trips.find(t => (t as any)._id.toString() === tripId);
    if (!trip) throw new NotFoundException('الرحلة غير موجودة');

    (trip as any).discount = null;
    (trip as any).netFee = trip.fee;
    const newBalance = trip.fee - trip.totalPaid;
    this.redistributeUnpaidInstallments(trip.installments, Math.max(newBalance, 0));
    record.markModified('trips');
    await record.save();

    return { message: 'تم إزالة الخصم من رسوم الرحلة بنجاح', data: trip };
  }
}
