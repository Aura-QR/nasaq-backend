import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { BusPlan } from './schemas/bus-plan.schema';
import { EnrollBusDto } from './dto/enroll-bus.dto';
import { SwitchBusPlanDto } from './dto/switch-bus-plan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';
import { FinancialRecordService } from './financial-record.service';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class BusService {
  constructor(
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(BusPlan.name) private busPlanModel: Model<BusPlan>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  private async getRecord(studentId: string, academicYearId?: string): Promise<StudentFinancialRecord> {
    this.validateObjectId(studentId, 'الطالب');
    const query: any = { studentId: new mongoose.Types.ObjectId(studentId) };
    if (academicYearId) {
      this.validateObjectId(academicYearId, 'العام الدراسي');
      query.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');
    return record;
  }

  async enroll(studentId: string, dto: EnrollBusDto, academicYearId?: string) {
    this.validateObjectId(studentId, 'الطالب');
    this.validateObjectId(dto.busPlanId, 'خطة الباص');

    const plan = await this.busPlanModel.findById(dto.busPlanId).exec();
    if (!plan || !plan.isActive) {
      throw new NotFoundException('خطة الباص غير موجودة أو غير مفعلة');
    }

    const record = await this.getRecord(studentId, academicYearId);

    if (record.bus?.enrolled) {
      throw new BadRequestException('الطالب مسجل بالفعل في خدمة الباص — قم بإلغاء التسجيل أولاً');
    }

    const { installments, planId } = await this.financialRecordService.resolveInstallments(
      plan.fee,
      plan.installmentPlanId ? plan.installmentPlanId.toString() : null,
    );

    record.bus = {
      enrolled: true,
      busPlanId: plan._id as mongoose.Types.ObjectId,
      planName: plan.name,
      serviceType: plan.serviceType,
      fee: plan.fee,
      discount: null,
      netFee: plan.fee,
      installmentPlanId: planId,
      status: FeeStatus.UNPAID,
      totalPaid: 0,
      installments,
    } as any;

    await record.save();
    return { message: 'تم تسجيل الطالب في خدمة الباص بنجاح', data: record.bus };
  }

  async switchPlan(studentId: string, dto: SwitchBusPlanDto) {
    this.validateObjectId(studentId, 'الطالب');
    this.validateObjectId(dto.busPlanId, 'خطة الباص');

    const record = await this.getRecord(studentId, dto.academicYearId);

    if (!record.bus?.enrolled) {
      throw new BadRequestException('الطالب غير مسجل في خدمة الباص');
    }

    const newPlan = await this.busPlanModel.findById(dto.busPlanId).exec();
    if (!newPlan || !newPlan.isActive) {
      throw new NotFoundException('خطة الباص غير موجودة أو غير مفعلة');
    }

    const hasAnyBusPayment =
      Number(record.bus.totalPaid || 0) > 0 ||
      (record.bus.installments || []).some(
        (inst) =>
          inst.status === PaymentStatus.PAID ||
          Number(inst.paidAmount || 0) > 0 ||
          (inst.payments?.length || 0) > 0,
      );

    if (hasAnyBusPayment) {
      throw new BadRequestException('لا يمكن تغيير خطة الباص بعد سداد أي دفعة من رسوم الباص');
    }

    let netFee = newPlan.fee;
    if (record.bus.discount) {
      const pct = record.bus.discount.percentage;
      const discountAmount = Math.round((newPlan.fee * pct) / 100);
      record.bus.discount.discountAmount = discountAmount;
      netFee = newPlan.fee - discountAmount;
    }

    const { installments, planId } = await this.financialRecordService.resolveInstallments(
      netFee,
      newPlan.installmentPlanId ? newPlan.installmentPlanId.toString() : null,
    );

    record.bus.busPlanId = newPlan._id as mongoose.Types.ObjectId;
    record.bus.planName = newPlan.name;
    record.bus.serviceType = newPlan.serviceType;
    record.bus.fee = newPlan.fee;
    record.bus.netFee = netFee;
    record.bus.installmentPlanId = planId;
    record.bus.installments = installments as any;
    record.bus.totalPaid = 0;
    record.bus.status = FeeStatus.UNPAID;
    record.markModified('bus');

    await record.save();
    return { message: 'تم تغيير خطة الباص بنجاح', data: record.bus };
  }

  async findOne(studentId: string) {
    this.validateObjectId(studentId, 'الطالب');
    const record = await this.getRecord(studentId);
    return { message: 'تم استرجاع بيانات الباص بنجاح', data: record.bus };
  }

  async findProfile(studentId: string) {
    this.validateObjectId(studentId, 'الطالب');
    const record = await this.recordModel
      .findOne({ studentId: new mongoose.Types.ObjectId(studentId) })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYearId gender')
      .populate('bus.installmentPlanId', 'name numberOfInstallments dueDates')
      .populate('bus.busPlanId', 'name serviceType fee')
      .lean()
      .exec();

    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    return {
      message: 'تم استرجاع ملف الباص بنجاح',
      data: {
        student: record.studentId,
        class: record.classId,
        academicYearId: record.academicYearId,
        bus: record.bus,
      },
    };
  }

  async findMyProfile(studentId: string) {
    return this.findProfile(studentId);
  }

  async findAll(filters: any = {}, pagination: any = {}) {
    const query: any = { 'bus.enrolled': true };

    if (filters.academicYear) query.academicYear = filters.academicYear;
    if (filters.classId && mongoose.Types.ObjectId.isValid(filters.classId)) {
      query.classId = new mongoose.Types.ObjectId(filters.classId);
    }

    const total = await this.recordModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginated = pagination.page !== undefined || pagination.limit !== undefined;

    let q = this.recordModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYearId gender')
      .populate('bus.installmentPlanId', 'name numberOfInstallments')
      .populate('bus.busPlanId', 'name serviceType fee');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const records = await q.exec();

    const data = records
      .filter((record: any) => record.studentId !== null)
      .map((record: any) => ({
        student: record.studentId,
        class: record.classId,
        academicYear: record.academicYear,
        bus: record.bus,
      }));

    if (isPaginated) {
      return {
        message: 'تم استرجاع طلاب خدمة الباص بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'تم استرجاع طلاب خدمة الباص بنجاح', data };
  }

  async findCandidates(filters: any = {}, pagination: any = {}) {
    const query: any = { 'bus.enrolled': false };

    if (filters.academicYear) query.academicYear = filters.academicYear;
    if (filters.classId && mongoose.Types.ObjectId.isValid(filters.classId)) {
      query.classId = new mongoose.Types.ObjectId(filters.classId);
    }

    const total = await this.recordModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginated = pagination.page !== undefined || pagination.limit !== undefined;

    let q = this.recordModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYearId gender');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const records = await q.exec();

    const data = records
      .filter((record: any) => record.studentId !== null)
      .map((record: any) => ({
        student: record.studentId,
        class: record.classId,
        academicYear: record.academicYear,
      }));

    if (isPaginated) {
      return {
        message: 'تم استرجاع الطلاب غير المشتركين في الباص بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'تم استرجاع الطلاب غير المشتركين في الباص بنجاح', data };
  }

  async pay(studentId: string, dto: RecordPaymentDto, adminId: string) {
    const record = await this.getRecord(studentId, dto.academicYearId);

    if (!record.bus.enrolled) throw new BadRequestException('الطالب غير مسجل في خدمة الباص');

    const inst = record.bus.installments.find(i => i.installmentNumber === dto.installmentNumber);
    if (!inst) throw new NotFoundException(`القسط رقم ${dto.installmentNumber} غير موجود`);
    if (inst.status === PaymentStatus.PAID) {
      throw new BadRequestException(`القسط رقم ${dto.installmentNumber} تم سداده بالفعل`);
    }
    const remaining = inst.amount - inst.paidAmount;
    if (dto.amount <= 0 || dto.amount > remaining) {
      throw new BadRequestException(
        `المبلغ يجب أن يكون بين 1 و ${remaining} جنيه (المتبقي من القسط)`,
      );
    }

    (inst.payments as any[]).push({
      amount: dto.amount,
      paidAt: new Date(dto.paidAt),
      recordedBy: new mongoose.Types.ObjectId(adminId),
      notes: dto.notes,
      type: 'payment',
    });
    inst.paidAmount += dto.amount;
    inst.status = inst.paidAmount >= inst.amount ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    record.bus.totalPaid = record.bus.installments.reduce((s, i) => s + i.paidAmount, 0);
    record.bus.status = this.financialRecordService.computeFeeStatus(record.bus.installments);

    await record.save();
    return { message: 'تم تسجيل دفعة الباص بنجاح', data: record.bus };
  }

  async refund(studentId: string, dto: RefundPaymentDto, adminId: string) {
    const record = await this.getRecord(studentId, dto.academicYearId);
    if (!record.bus.enrolled) throw new BadRequestException('الطالب غير مسجل في خدمة الباص');

    const inst = record.bus.installments.find(i => i.installmentNumber === dto.installmentNumber);
    if (!inst) throw new NotFoundException(`القسط رقم ${dto.installmentNumber} غير موجود`);

    if (inst.paidAmount <= 0) {
      throw new BadRequestException(`لا توجد مدفوعات مسجلة على القسط رقم ${dto.installmentNumber} لاستردادها`);
    }

    if (dto.amount <= 0 || dto.amount > inst.paidAmount) {
      throw new BadRequestException(
        `المبلغ المسترد يجب أن يكون بين 1 و ${inst.paidAmount} جنيه (المبلغ المدفوع حالياً من القسط)`,
      );
    }

    (inst.payments as any[]).push({
      amount: dto.amount,
      paidAt: dto.refundedAt ? new Date(dto.refundedAt) : new Date(),
      recordedBy: new mongoose.Types.ObjectId(adminId),
      notes: dto.reason,
      type: 'refund',
    });

    inst.paidAmount -= dto.amount;
    inst.status =
      inst.paidAmount >= inst.amount
        ? PaymentStatus.PAID
        : inst.paidAmount > 0
        ? PaymentStatus.PARTIAL
        : PaymentStatus.PENDING;

    record.bus.totalPaid = record.bus.installments.reduce((s, i) => s + i.paidAmount, 0);
    record.bus.status = this.financialRecordService.computeFeeStatus(record.bus.installments);

    await record.save();
    return { message: 'تم تسجيل استرداد مبلغ الباص بنجاح', data: record.bus };
  }

  async unenroll(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);
    if (!record.bus.enrolled) throw new BadRequestException('الطالب غير مسجل في خدمة الباص');
    record.bus.enrolled = false;
    await record.save();
    return { message: 'تم إلغاء تسجيل الطالب من خدمة الباص' };
  }
}
