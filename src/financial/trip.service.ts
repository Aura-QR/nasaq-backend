import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { InstallmentPlan } from './schemas/installment-plan.schema';
import { FinancialTrip } from './schemas/financial-trip.schema';
import { AddTripDto } from './dto/add-trip.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';
import { FinancialRecordService } from './financial-record.service';
import { CreateFinancialTripDto } from './dto/create-financial-trip.dto';
import { EnrollTripStudentDto } from './dto/enroll-trip-student.dto';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class TripService {
  constructor(
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(InstallmentPlan.name) private planModel: Model<InstallmentPlan>,
    @InjectModel(FinancialTrip.name) private tripTemplateModel: Model<FinancialTrip>,
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

  private async resolveInstallments(fee: number, installmentPlanId?: string | null) {
    let installments: any[] = [];
    let planId: mongoose.Types.ObjectId | null = null;

    if (installmentPlanId) {
      this.validateObjectId(installmentPlanId, 'خطة التقسيط');
      const plan = await this.planModel.findById(installmentPlanId).exec();
      if (!plan) throw new NotFoundException('خطة التقسيط غير موجودة');
      installments = this.financialRecordService.buildInstallments(fee, plan);
      planId = plan._id as mongoose.Types.ObjectId;
    } else {
      installments = [{
        installmentNumber: 1,
        amount: fee,
        dueDate: new Date(),
        status: PaymentStatus.PENDING,
        paidAmount: 0,
        payments: [],
      }];
    }

    return { installments, planId };
  }

  async createTemplate(dto: CreateFinancialTripDto) {
    const created = await this.tripTemplateModel.create({
      name: dto.name,
      description: dto.description,
      fee: dto.fee,
      isActive: true,
    });

    return { message: 'تم إنشاء الرحلة بنجاح', data: created };
  }

  async findTemplates() {
    const data = await this.tripTemplateModel
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .exec();

    return { message: 'تم استرجاع الرحلات بنجاح', data };
  }

  async findTemplate(templateId: string) {
    this.validateObjectId(templateId, 'الرحلة');
    const template = await this.tripTemplateModel
      .findById(templateId)
      .exec();
    if (!template || !template.isActive) throw new NotFoundException('الرحلة غير موجودة');

    const enrolledCount = await this.recordModel.countDocuments({
      trips: {
        $elemMatch: {
          tripTemplateId: new mongoose.Types.ObjectId(templateId),
        },
      },
    });

    return { message: 'تم استرجاع تفاصيل الرحلة بنجاح', data: { ...template.toObject(), enrolledCount } };
  }

  async findTemplateStudents(templateId: string, filters: any = {}, pagination: any = {}) {
    this.validateObjectId(templateId, 'الرحلة');
    const templateObjectId = new mongoose.Types.ObjectId(templateId);

    const query: any = {
      trips: {
        $elemMatch: {
          tripTemplateId: templateObjectId,
        },
      },
    };

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
      .map((record: any) => {
        const trip = (record.trips || []).find((t: any) => t.tripTemplateId?.toString() === templateId);
        return {
          student: record.studentId,
          class: record.classId,
          academicYear: record.academicYear,
          trip,
        };
      }).filter((item) => item.trip);

    if (isPaginated) {
      return {
        message: 'تم استرجاع طلاب الرحلة بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'تم استرجاع طلاب الرحلة بنجاح', data };
  }

  async findTemplateCandidates(templateId: string, filters: any = {}, pagination: any = {}) {
    this.validateObjectId(templateId, 'الرحلة');
    const templateObjectId = new mongoose.Types.ObjectId(templateId);

    const query: any = {
      trips: {
        $not: {
          $elemMatch: {
            tripTemplateId: templateObjectId,
          },
        },
      },
    };

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
        message: 'تم استرجاع الطلاب المتاحين للرحلة بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'تم استرجاع الطلاب المتاحين للرحلة بنجاح', data };
  }

  async enrollStudent(templateId: string, dto: EnrollTripStudentDto) {
    this.validateObjectId(templateId, 'الرحلة');
    this.validateObjectId(dto.studentId, 'الطالب');

    const template = await this.tripTemplateModel.findById(templateId).exec();
    if (!template || !template.isActive) throw new NotFoundException('الرحلة غير موجودة');

    const record = await this.getRecord(dto.studentId);
    const exists = (record.trips || []).some((t: any) => t.tripTemplateId?.toString() === templateId);
    if (exists) throw new BadRequestException('الطالب مسجل بالفعل في هذه الرحلة');

    const chosenInstallmentPlanId = dto.installmentPlanId || null;
    const { installments, planId } = await this.resolveInstallments(template.fee, chosenInstallmentPlanId);

    (record.trips as any[]).push({
      tripTemplateId: template._id,
      name: template.name,
      description: template.description,
      fee: template.fee,
      netFee: template.fee,
      installmentPlanId: planId,
      status: FeeStatus.UNPAID,
      totalPaid: 0,
      installments,
    });

    await record.save();
    return { message: 'تم إضافة الطالب إلى الرحلة بنجاح', data: record.trips[record.trips.length - 1] };
  }

  async removeStudent(templateId: string, studentId: string) {
    this.validateObjectId(templateId, 'الرحلة');
    this.validateObjectId(studentId, 'الطالب');
    const record = await this.getRecord(studentId);

    const tripIndex = record.trips.findIndex((t: any) => t.tripTemplateId?.toString() === templateId);
    if (tripIndex === -1) throw new NotFoundException('الطالب غير مسجل في هذه الرحلة');

    record.trips.splice(tripIndex, 1);
    await record.save();
    return { message: 'تم إزالة الطالب من الرحلة بنجاح' };
  }

  async create(studentId: string, dto: AddTripDto, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);

    const { installments, planId } = await this.resolveInstallments(dto.fee, dto.installmentPlanId);

    (record.trips as any[]).push({
      name: dto.name,
      description: dto.description,
      fee: dto.fee,
      netFee: dto.fee,
      installmentPlanId: planId,
      status: FeeStatus.UNPAID,
      totalPaid: 0,
      installments,
    });

    await record.save();
    return { message: 'تم إضافة الرحلة بنجاح', data: record.trips[record.trips.length - 1] };
  }

  async find(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);
    return { message: 'تم استرجاع رحلات الطالب بنجاح', data: record.trips };
  }

  async findOne(studentId: string, tripId: string, academicYearId?: string) {
    this.validateObjectId(tripId, 'الرحلة');
    const record = await this.getRecord(studentId, academicYearId);
    const trip = record.trips.find(t => (t as any)._id.toString() === tripId);
    if (!trip) throw new NotFoundException('الرحلة غير موجودة');
    return { message: 'تم استرجاع الرحلة بنجاح', data: trip };
  }

  async pay(studentId: string, tripId: string, dto: RecordPaymentDto, adminId: string) {
    this.validateObjectId(tripId, 'الرحلة');
    const record = await this.getRecord(studentId, dto.academicYearId);

    const trip = record.trips.find(t => (t as any)._id.toString() === tripId);
    if (!trip) throw new NotFoundException('الرحلة غير موجودة');

    const inst = trip.installments.find(i => i.installmentNumber === dto.installmentNumber);
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
    (trip as any).totalPaid = trip.installments.reduce((s, i) => s + i.paidAmount, 0);
    (trip as any).status = this.financialRecordService.computeFeeStatus(trip.installments);

    await record.save();
    return { message: 'تم تسجيل دفعة الرحلة بنجاح', data: trip };
  }

  async refund(studentId: string, tripId: string, dto: RefundPaymentDto, adminId: string) {
    this.validateObjectId(tripId, 'الرحلة');
    const record = await this.getRecord(studentId, dto.academicYearId);

    const trip = record.trips.find(t => (t as any)._id.toString() === tripId);
    if (!trip) throw new NotFoundException('الرحلة غير موجودة');

    const inst = trip.installments.find(i => i.installmentNumber === dto.installmentNumber);
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

    (trip as any).totalPaid = trip.installments.reduce((s, i) => s + i.paidAmount, 0);
    (trip as any).status = this.financialRecordService.computeFeeStatus(trip.installments);

    await record.save();
    return { message: 'تم تسجيل استرداد مبلغ الرحلة بنجاح', data: trip };
  }

  async delete(studentId: string, tripId: string, academicYearId?: string) {
    this.validateObjectId(tripId, 'الرحلة');
    const record = await this.getRecord(studentId, academicYearId);
    const tripIndex = record.trips.findIndex(t => (t as any)._id.toString() === tripId);
    if (tripIndex === -1) throw new NotFoundException('الرحلة غير موجودة');
    record.trips.splice(tripIndex, 1);
    await record.save();
    return { message: 'تم حذف الرحلة بنجاح' };
  }
}
