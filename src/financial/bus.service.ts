import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { InstallmentPlan } from './schemas/installment-plan.schema';
import { EnrollBusDto } from './dto/enroll-bus.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';
import { FinancialRecordService } from './financial-record.service';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class BusService {
  constructor(
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(InstallmentPlan.name) private planModel: Model<InstallmentPlan>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  private validateObjectId(id: string, name = 'Ø§Ù„Ù…Ø¹Ø±Ù'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`ØµÙŠØºØ© ${name} ØºÙŠØ± ØµØ­ÙŠØ­Ø©`);
    }
  }

  private async getRecord(studentId: string): Promise<StudentFinancialRecord> {
    const record = await this.recordModel
      .findOne({ studentId: new mongoose.Types.ObjectId(studentId) })
      .exec();
    if (!record) throw new NotFoundException('Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ Ù…Ø§Ù„ÙŠ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨');
    return record;
  }

  async enroll(studentId: string, dto: EnrollBusDto) {
    this.validateObjectId(studentId, 'Ø§Ù„Ø·Ø§Ù„Ø¨');
    const record = await this.getRecord(studentId);

    if (record.bus.enrolled) {
      throw new BadRequestException('Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ø³Ø¬Ù„ Ø¨Ø§Ù„ÙØ¹Ù„ ÙÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ â€” Ù‚Ù… Ø¨Ø¥Ù„ØºØ§Ø¡ Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ø£ÙˆÙ„Ø§Ù‹');
    }

    let installments: any[] = [];
    let planId: mongoose.Types.ObjectId | null = null;

    if (dto.installmentPlanId) {
      this.validateObjectId(dto.installmentPlanId, 'Ø®Ø·Ø© Ø§Ù„ØªÙ‚Ø³ÙŠØ·');
      const plan = await this.planModel.findById(dto.installmentPlanId).exec();
      if (!plan) throw new NotFoundException('Ø®Ø·Ø© Ø§Ù„ØªÙ‚Ø³ÙŠØ· ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
      installments = this.financialRecordService.buildInstallments(dto.fee, plan);
      planId = plan._id as mongoose.Types.ObjectId;
    } else {
      installments = [{
        installmentNumber: 1,
        amount: dto.fee,
        dueDate: new Date(),
        status: PaymentStatus.PENDING,
        paidAmount: 0,
        payments: [],
      }];
    }

    record.bus = {
      enrolled: true,
      serviceType: dto.serviceType,
      fee: dto.fee,
      netFee: dto.fee,
      installmentPlanId: planId,
      status: FeeStatus.UNPAID,
      totalPaid: 0,
      installments,
    } as any;

    await record.save();
    return { message: 'ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ ÙÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­', data: record.bus };
  }

  async findOne(studentId: string) {
    this.validateObjectId(studentId, 'Ø§Ù„Ø·Ø§Ù„Ø¨');
    const record = await this.getRecord(studentId);
    return { message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­', data: record.bus };
  }

  async findProfile(studentId: string) {
    this.validateObjectId(studentId, 'Ø§Ù„Ø·Ø§Ù„Ø¨');
    const record = await this.recordModel
      .findOne({ studentId: new mongoose.Types.ObjectId(studentId) })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYear gender')
      .populate('bus.installmentPlanId', 'name numberOfInstallments dueDates')
      .lean()
      .exec();

    if (!record) throw new NotFoundException('Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ Ù…Ø§Ù„ÙŠ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨');

    return {
      message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ù…Ù„Ù Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­',
      data: {
        student: record.studentId,
        class: record.classId,
        academicYear: record.academicYear,
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
      .populate('classId', 'roomNumber academicYear gender')
      .populate('bus.installmentPlanId', 'name numberOfInstallments');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const records = await q.exec();

    const data = records.map((record: any) => ({
      student: record.studentId,
      class: record.classId,
      academicYear: record.academicYear,
      bus: record.bus,
    }));

    if (isPaginated) {
      return {
        message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ø·Ù„Ø§Ø¨ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ø·Ù„Ø§Ø¨ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­', data };
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
      .populate('classId', 'roomNumber academicYear gender');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const records = await q.exec();

    const data = records.map((record: any) => ({
      student: record.studentId,
      class: record.classId,
      academicYear: record.academicYear,
    }));

    if (isPaginated) {
      return {
        message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ø§Ù„Ø·Ù„Ø§Ø¨ ØºÙŠØ± Ø§Ù„Ù…Ø´ØªØ±ÙƒÙŠÙ† ÙÙŠ Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'ØªÙ… Ø§Ø³ØªØ±Ø¬Ø§Ø¹ Ø§Ù„Ø·Ù„Ø§Ø¨ ØºÙŠØ± Ø§Ù„Ù…Ø´ØªØ±ÙƒÙŠÙ† ÙÙŠ Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­', data };
  }

  async pay(studentId: string, dto: RecordPaymentDto, adminId: string) {
    this.validateObjectId(studentId, 'Ø§Ù„Ø·Ø§Ù„Ø¨');
    const record = await this.getRecord(studentId);

    if (!record.bus.enrolled) throw new BadRequestException('Ø§Ù„Ø·Ø§Ù„Ø¨ ØºÙŠØ± Ù…Ø³Ø¬Ù„ ÙÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ');

    const inst = record.bus.installments.find(i => i.installmentNumber === dto.installmentNumber);
    if (!inst) throw new NotFoundException(`Ø§Ù„Ù‚Ø³Ø· Ø±Ù‚Ù… ${dto.installmentNumber} ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯`);
    if (inst.status === PaymentStatus.PAID) {
      throw new BadRequestException(`Ø§Ù„Ù‚Ø³Ø· Ø±Ù‚Ù… ${dto.installmentNumber} ØªÙ… Ø³Ø¯Ø§Ø¯Ù‡ Ø¨Ø§Ù„ÙØ¹Ù„`);
    }
    if (dto.amount !== inst.amount) {
      throw new BadRequestException(`Ù…Ø¨Ù„Øº Ø§Ù„Ù‚Ø³Ø· Ø§Ù„ØµØ­ÙŠØ­ Ù‡Ùˆ ${inst.amount} Ø¬Ù†ÙŠÙ‡`);
    }

    (inst.payments as any[]).push({
      amount: dto.amount,
      paidAt: new Date(dto.paidAt),
      recordedBy: new mongoose.Types.ObjectId(adminId),
      notes: dto.notes,
    });
    inst.paidAmount = dto.amount;
    inst.status = PaymentStatus.PAID;
    record.bus.totalPaid = record.bus.installments.reduce((s, i) => s + i.paidAmount, 0);
    record.bus.status = this.financialRecordService.computeFeeStatus(record.bus.installments);

    await record.save();
    return { message: 'ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø¯ÙØ¹Ø© Ø§Ù„Ø¨Ø§Øµ Ø¨Ù†Ø¬Ø§Ø­', data: record.bus };
  }

  async unenroll(studentId: string) {
    this.validateObjectId(studentId, 'Ø§Ù„Ø·Ø§Ù„Ø¨');
    const record = await this.getRecord(studentId);
    if (!record.bus.enrolled) throw new BadRequestException('Ø§Ù„Ø·Ø§Ù„Ø¨ ØºÙŠØ± Ù…Ø³Ø¬Ù„ ÙÙŠ Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ');
    record.bus.enrolled = false;
    await record.save();
    return { message: 'ØªÙ… Ø¥Ù„ØºØ§Ø¡ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ù† Ø®Ø¯Ù…Ø© Ø§Ù„Ø¨Ø§Øµ' };
  }
}
