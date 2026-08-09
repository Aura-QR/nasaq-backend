import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { FeeConfig } from './schemas/fee-config.schema';
import { InstallmentPlan } from './schemas/installment-plan.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { FinancialTrip } from './schemas/financial-trip.schema';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class FinancialRecordService {
  constructor(
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(FeeConfig.name) private feeConfigModel: Model<FeeConfig>,
    @InjectModel(InstallmentPlan.name) private planModel: Model<InstallmentPlan>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(FinancialTrip.name) private tripTemplateModel: Model<FinancialTrip>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  private buildStudentQuery(studentId: string, academicYearId?: string): any {
    this.validateObjectId(studentId, 'الطالب');
    const query: any = { studentId: new mongoose.Types.ObjectId(studentId) };
    if (academicYearId) {
      this.validateObjectId(academicYearId, 'العام الدراسي');
      query.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }
    return query;
  }

  buildInstallments(fee: number, plan: InstallmentPlan) {
    const n = plan.numberOfInstallments;
    const base = Math.floor(fee / n);
    const remainder = fee - base * n;
    return plan.dueDates.map((dueDate, i) => ({
      installmentNumber: i + 1,
      amount: i === n - 1 ? base + remainder : base,
      dueDate: new Date(dueDate),
      status: PaymentStatus.PENDING,
      paidAmount: 0,
      payments: [],
    }));
  }

  computeFeeStatus(installments: any[]): FeeStatus {
    const allPaid = installments.every(i => i.status === PaymentStatus.PAID);
    const anyProgress = installments.some(
      i => i.status === PaymentStatus.PAID || i.status === PaymentStatus.PARTIAL,
    );
    return allPaid ? FeeStatus.PAID : anyProgress ? FeeStatus.PARTIAL : FeeStatus.UNPAID;
  }

  private buildSingleInstallment(fee: number) {
    return [{
      installmentNumber: 1,
      amount: fee,
      dueDate: new Date(),
      status: PaymentStatus.PENDING,
      paidAmount: 0,
      payments: [],
    }];
  }

  // Called by EnrollmentsService when a student is enrolled into a class.
  // schoolId is passed explicitly rather than read from AsyncLocalStorage because
  // ALS context may not reliably propagate through all NestJS interceptor boundaries.
  async createOrUpdateRecord(studentId: string, classId: string, schoolId: string): Promise<void> {
    const student = await this.studentModel.findById(studentId).exec();
    if (!student) return;

    const cls = await this.classModel.findById(classId).exec();
    if (!cls) return;

    const feeConfig = await this.feeConfigModel.findOne({
      academicYearId: cls.academicYearId,
      gradeLevelId: cls.gradeLevelId,
    }).exec();
    if (!feeConfig) {
      throw new BadRequestException(
        `لا توجد معايير رسوم للعام الدراسي والمرحلة الدراسية المحددة. يرجى إنشاؤها أولاً قبل إضافة الطالب للفصل.`,
      );
    }

    let plan: InstallmentPlan | null = null;
    if ((student as any).installmentPlanId) {
      plan = await this.planModel.findById((student as any).installmentPlanId).exec();
    }
    if (!plan) {
      plan = await this.planModel.findOne({ isDefault: true, isActive: true }).exec();
    }
    if (!plan) {
      throw new BadRequestException(
        `لا توجد خطة تقسيط افتراضية. يرجى إنشاء خطة تقسيط وتعيينها كافتراضية قبل تسجيل الطلاب.`,
      );
    }

    const planId = plan._id as mongoose.Types.ObjectId;
    const studentOid = new mongoose.Types.ObjectId(studentId);
    const classOid = new mongoose.Types.ObjectId(classId);

    // schoolId is passed in explicitly — do NOT read from AsyncLocalStorage here.
    // ALS context is not guaranteed to propagate reliably across all async
    // boundaries inside NestJS interceptor-wrapped Observables.
    const schoolOid = new mongoose.Types.ObjectId(schoolId);

    // Use findOneAndUpdate with upsert to make this atomic and avoid race conditions.
    // $setOnInsert only runs when a new document is created; $set runs on both create and update.
    const existing = await this.recordModel.findOneAndUpdate(
      { studentId: studentOid, academicYearId: cls.academicYearId },
      {
        $set: {
          classId: classOid,
          feeConfigId: feeConfig._id,
          installmentPlanId: planId,
        },
        $setOnInsert: {
          schoolId: schoolOid,
          tuition: {
            fee: feeConfig.tuitionFee,
            netFee: feeConfig.tuitionFee,
            status: FeeStatus.UNPAID,
            totalPaid: 0,
            installments: this.buildInstallments(feeConfig.tuitionFee, plan),
          },
          bus: { enrolled: false, serviceType: 'both', fee: 0, netFee: 0, totalPaid: 0, status: FeeStatus.UNPAID, installments: [] },
          trips: [],
        },
      },
      { upsert: true, new: false },
    ).exec();

    // If the record already existed (existing !== null), check if the fee config changed
    // and rebuild unpaid installments accordingly.
    if (existing) {
      const feeChanged = existing.feeConfigId.toString() !== (feeConfig._id as mongoose.Types.ObjectId).toString();
      if (feeChanged) {
        const record = await this.recordModel.findOne({ studentId: studentOid, academicYearId: cls.academicYearId }).exec();
        if (record) {
          record.tuition.fee = feeConfig.tuitionFee;
          record.tuition.netFee = feeConfig.tuitionFee;
          const unpaidInstallments = record.tuition.installments.filter(i => i.status !== 'paid');
          const totalUnpaid = feeConfig.tuitionFee - record.tuition.totalPaid;
          if (unpaidInstallments.length > 0 && totalUnpaid > 0) {
            const rebuilt = this.buildInstallments(totalUnpaid, plan);
            unpaidInstallments.forEach((inst, i) => {
              inst.amount = rebuilt[i]?.amount ?? inst.amount;
            });
          }
          record.markModified('tuition');
          await record.save();
        }
      }
    }
  }

  async find(filters: any = {}, pagination: any = {}) {
    const query: any = {};
    const ayId = filters.academicYearId || filters.academicYear;
    if (ayId && mongoose.Types.ObjectId.isValid(ayId)) {
      query.academicYearId = new mongoose.Types.ObjectId(ayId);
    }
    if (filters.classId && mongoose.Types.ObjectId.isValid(filters.classId)) {
      query.classId = new mongoose.Types.ObjectId(filters.classId);
    }
    if (filters.tuitionStatus) query['tuition.status'] = filters.tuitionStatus;
    if (filters.studentName) {
      const matchedStudents = await this.studentModel
        .find(
          { name: { $regex: String(filters.studentName).trim(), $options: 'i' } },
          { _id: 1 },
        )
        .lean()
        .exec();

      query.studentId = {
        $in: matchedStudents.map((student) => new mongoose.Types.ObjectId((student as any)._id)),
      };
    }

    const total = await this.recordModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginated = pagination.page !== undefined || pagination.limit !== undefined;

    let q = this.recordModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYearId gender')
      .populate('installmentPlanId', 'name numberOfInstallments');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const data = await q.exec();

    if (isPaginated) {
      return {
        message: 'تم استرجاع السجلات المالية بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }
    return { message: 'تم استرجاع السجلات المالية بنجاح', data };
  }

  async findOne(studentId: string, academicYearId?: string) {
    const query = this.buildStudentQuery(studentId, academicYearId);
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .populate('studentId', 'name email schoolEmail')
      .populate('classId', 'roomNumber academicYearId gender')
      .populate('installmentPlanId', 'name numberOfInstallments dueDates')
      .lean()
      .exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const data = {
      ...record,
      tuition: {
        ...record.tuition,
        fee: record.tuition.discount ? record.tuition.netFee : record.tuition.fee,
        discountApplied: !!record.tuition.discount,
      },
      bus: {
        ...record.bus,
        fee: record.bus.discount ? record.bus.netFee : record.bus.fee,
        discountApplied: !!record.bus.discount,
      },
      trips: record.trips.map(t => ({
        ...t,
        fee: (t as any).discount ? (t as any).netFee : t.fee,
        discountApplied: !!(t as any).discount,
      })),
    };

    return { message: 'تم استرجاع السجل المالي بنجاح', data };
  }

  async findMyRecord(studentId: string, academicYearId?: string) {
    return this.findOne(studentId, academicYearId);
  }

  async getSummary(studentId: string, academicYearId?: string) {
    const query = this.buildStudentQuery(studentId, academicYearId);
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const mapInstallments = (installments: any[]) =>
      installments.map(i => ({
        installmentNumber: i.installmentNumber,
        amount: i.amount,
        dueDate: i.dueDate,
        status: i.status,
        paidAmount: i.paidAmount,
      }));

    return {
      studentId: record.studentId,
      academicYearId: record.academicYearId,
      tuition: {
        fee: record.tuition.discount ? record.tuition.netFee : record.tuition.fee,
        discountApplied: !!record.tuition.discount,
        totalPaid: record.tuition.totalPaid,
        remaining: (record.tuition.discount ? record.tuition.netFee : record.tuition.fee) - record.tuition.totalPaid,
        status: record.tuition.status,
        installments: mapInstallments(record.tuition.installments),
      },
      bus: record.bus.enrolled
        ? {
            enrolled: true,
            fee: record.bus.discount ? record.bus.netFee : record.bus.fee,
            discountApplied: !!record.bus.discount,
            totalPaid: record.bus.totalPaid,
            remaining: (record.bus.discount ? record.bus.netFee : record.bus.fee) - record.bus.totalPaid,
            status: record.bus.status,
            installments: mapInstallments(record.bus.installments),
          }
        : { enrolled: false },
      trips: record.trips.map(trip => ({
        tripId: (trip as any)._id,
        name: trip.name,
        fee: (trip as any).discount ? (trip as any).netFee : trip.fee,
        discountApplied: !!(trip as any).discount,
        totalPaid: trip.totalPaid,
        remaining: ((trip as any).discount ? (trip as any).netFee : trip.fee) - trip.totalPaid,
        status: trip.status,
        installments: mapInstallments(trip.installments),
      })),
    };
  }

  async getMyTripsOverview(studentId: string, academicYearId?: string) {
    const query = this.buildStudentQuery(studentId, academicYearId);

    const [record, templates] = await Promise.all([
      this.recordModel
        .findOne(query)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.tripTemplateModel
        .find({ isActive: true })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
    ]);

    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const mapInstallments = (installments: any[] = []) =>
      installments.map(i => ({
        installmentNumber: i.installmentNumber,
        amount: i.amount,
        dueDate: i.dueDate,
        status: i.status,
        paidAmount: i.paidAmount,
      }));

    const enrolledByTemplateId = new Map(
      (record.trips || [])
        .filter((trip: any) => trip?.tripTemplateId)
        .map((trip: any) => [trip.tripTemplateId.toString(), trip]),
    );

    const allTrips = templates.map((template: any) => {
      const enrolledTrip = enrolledByTemplateId.get(template._id.toString());
      const enrolledFee = enrolledTrip
        ? (enrolledTrip.discount ? enrolledTrip.netFee : enrolledTrip.fee)
        : template.fee;
      const enrolledTotalPaid = enrolledTrip ? Number(enrolledTrip.totalPaid || 0) : 0;

      return {
        tripTemplateId: template._id,
        name: template.name,
        description: template.description,
        fee: template.fee,
        isEnrolled: !!enrolledTrip,
        status: enrolledTrip?.status || null,
        totalPaid: enrolledTotalPaid,
        remaining: enrolledTrip ? Math.max(Number(enrolledFee || 0) - enrolledTotalPaid, 0) : null,
      };
    });

    const enrolledTrips = (record.trips || [])
      .filter((trip: any) => trip?.tripTemplateId)
      .map((trip: any) => {
        const effectiveFee = trip.discount ? trip.netFee : trip.fee;
        const totalPaid = Number(trip.totalPaid || 0);

        return {
          tripId: trip._id,
          tripTemplateId: trip.tripTemplateId,
          name: trip.name,
          description: trip.description,
          fee: effectiveFee,
          discountApplied: !!trip.discount,
          status: trip.status,
          totalPaid,
          remaining: Math.max(Number(effectiveFee || 0) - totalPaid, 0),
          installments: mapInstallments(trip.installments || []),
        };
      });

    return {
      message: 'تم استرجاع بيانات الرحلات بنجاح',
      data: {
        allTrips,
        enrolledTrips,
      },
    };
  }

  async payTuition(studentId: string, dto: RecordPaymentDto, adminId: string) {
    const query = this.buildStudentQuery(studentId, dto.academicYearId);
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const inst = record.tuition.installments.find(i => i.installmentNumber === dto.installmentNumber);
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
    record.tuition.totalPaid = record.tuition.installments.reduce((s, i) => s + i.paidAmount, 0);
    record.tuition.status = this.computeFeeStatus(record.tuition.installments);

    await record.save();
    return { message: 'تم تسجيل دفعة القسط بنجاح', data: record.tuition };
  }

  async refundTuition(studentId: string, dto: RefundPaymentDto, adminId: string) {
    const query = this.buildStudentQuery(studentId, dto.academicYearId);
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const inst = record.tuition.installments.find(i => i.installmentNumber === dto.installmentNumber);
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

    record.tuition.totalPaid = record.tuition.installments.reduce((s, i) => s + i.paidAmount, 0);
    record.tuition.status = this.computeFeeStatus(record.tuition.installments);

    await record.save();
    return { message: 'تم تسجيل استرداد المبلغ بنجاح', data: record.tuition };
  }

  async switchTuitionInstallmentPlan(studentId: string, installmentPlanId?: string | null, academicYearId?: string) {
    let plan: InstallmentPlan | null = null;
    if (installmentPlanId) {
      this.validateObjectId(installmentPlanId, 'خطة التقسيط');
      plan = await this.planModel.findById(installmentPlanId).exec();
      if (!plan) {
        throw new NotFoundException('خطة التقسيط غير موجودة');
      }
    }

    const query = this.buildStudentQuery(studentId, academicYearId);
    const record = await this.recordModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();

    if (!record) return;

    const hasAnyTuitionPayment =
      Number(record.tuition.totalPaid || 0) > 0 ||
      (record.tuition.installments || []).some(
        (inst) =>
          inst.status === PaymentStatus.PAID ||
          Number(inst.paidAmount || 0) > 0 ||
          (inst.payments?.length || 0) > 0,
      );

    if (hasAnyTuitionPayment) {
      throw new BadRequestException('لا يمكن تغيير خطة التقسيط بعد سداد أي قسط دراسي');
    }

    const effectiveFee = record.tuition.discount ? record.tuition.netFee : record.tuition.fee;
    const rebuiltInstallments = plan
      ? this.buildInstallments(effectiveFee, plan)
      : this.buildSingleInstallment(effectiveFee);

    record.installmentPlanId = plan ? (plan._id as mongoose.Types.ObjectId) : null;
    record.tuition.installments = rebuiltInstallments as any;
    record.tuition.totalPaid = 0;
    record.tuition.status = FeeStatus.UNPAID;
    record.markModified('tuition');

    await record.save();
  }
}
