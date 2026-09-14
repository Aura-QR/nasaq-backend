import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Model } from 'mongoose';
import { School } from '../platform/schools/schemas/school.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';
import { FinancialRecordService } from './financial-record.service';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';

const DEFAULT_TIMEZONE = 'Asia/Riyadh';

/**
 * Voiding a payment that was recorded by mistake.
 *
 * A payment is never edited or deleted: rewriting an amount leaves no trace of
 * what it was, and a school's money record has to answer "what happened" long
 * after the fact. A void marks the entry, keeps it in place with who voided it,
 * when and why, and takes its amount back out of what was paid.
 *
 * It is not a refund. A refund is money that changed hands and went back; a
 * void says the money never changed hands. Recording a typo as a refund reads,
 * a month later, as the school handing money back to a parent.
 *
 * Who may void:
 * - the school owner, at any time;
 * - whoever recorded the payment, on the same calendar day in the school's
 *   timezone — mistakes are caught at the counter, and anything later is a
 *   decision for someone accountable.
 */
@Injectable()
export class PaymentVoidService {
  constructor(
    @InjectModel(StudentFinancialRecord.name)
    private readonly recordModel: Model<StudentFinancialRecord>,
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  async voidPayment(
    studentId: string,
    dto: VoidPaymentDto,
    user: { userId: string; role: string; schoolId?: string },
  ) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new BadRequestException('صيغة معرف الطالب غير صحيحة');
    }

    const query: any = { studentId: new mongoose.Types.ObjectId(studentId) };
    if (dto.academicYearId) {
      query.academicYearId = new mongoose.Types.ObjectId(dto.academicYearId);
    }
    const record: any = await this.recordModel.findOne(query).sort({ createdAt: -1 }).exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const located = this.locate(record, dto);
    const { container, base, section, installments } = located;

    const target = (container.payments ?? [])[dto.paymentIndex];
    if (!target) throw new NotFoundException('الدفعة غير موجودة');
    if (target.type === 'refund') {
      throw new BadRequestException(
        'هذا قيد استرداد وليس دفعة. الإلغاء متاح للدفعات فقط.',
      );
    }
    if (target.voidedAt) throw new BadRequestException('هذه الدفعة ملغاة بالفعل');
    if (Number(target.amount) !== Number(dto.expectedAmount)) {
      throw new ConflictException('تغيّر سجل الدفعات. حدّث الصفحة ثم أعد المحاولة.');
    }

    await this.assertCanVoid(target, user);

    const amount = Number(target.amount) || 0;
    const currentPaid = Number(container.paidAmount) || 0;
    const nextPaid = currentPaid - amount;
    if (nextPaid < 0) {
      // A refund recorded after this payment already took part of it back;
      // voiding the whole payment would leave less than nothing paid.
      throw new BadRequestException(
        'لا يمكن إلغاء هذه الدفعة لأن جزءًا منها استُرد بعد تسجيلها.',
      );
    }

    const now = new Date();
    const set: Record<string, unknown> = {
      [`${base}.payments.${dto.paymentIndex}.voidedAt`]: now,
      [`${base}.payments.${dto.paymentIndex}.voidedBy`]: new mongoose.Types.ObjectId(user.userId),
      [`${base}.payments.${dto.paymentIndex}.voidReason`]: dto.reason,
      [`${base}.paidAmount`]: nextPaid,
    };

    /*
     * The optimistic lock. The update only lands if nothing moved since the
     * record was read: this entry is still unvoided with the same amount, and
     * the paid total it is subtracted from is unchanged. A second press of
     * "void", or a payment recorded on another installment in between, matches
     * nothing and is reported instead of subtracting twice or overwriting a
     * total computed from stale numbers.
     */
    const filter: Record<string, unknown> = {
      _id: record._id,
      [`${base}.payments.${dto.paymentIndex}.voidedAt`]: null,
      [`${base}.payments.${dto.paymentIndex}.amount`]: target.amount,
      [`${base}.paidAmount`]: container.paidAmount,
    };

    if (installments) {
      const inst = container;
      set[`${base}.status`] =
        nextPaid >= Number(inst.amount)
          ? PaymentStatus.PAID
          : nextPaid > 0
          ? PaymentStatus.PARTIAL
          : PaymentStatus.PENDING;

      const after = installments.map((i: any) =>
        i === inst ? { ...this.plain(i), paidAmount: nextPaid, status: set[`${base}.status`] } : this.plain(i),
      );
      const sectionTotal = Number(record.get(`${section}.totalPaid`)) || 0;
      set[`${section}.totalPaid`] = after.reduce((sum: number, i: any) => sum + (Number(i.paidAmount) || 0), 0);
      set[`${section}.status`] = this.financialRecordService.computeFeeStatus(after) as FeeStatus;
      filter[`${section}.totalPaid`] = sectionTotal;
    } else {
      set[`${base}.status`] = nextPaid >= Number(container.amount) ? 'paid' : 'unpaid';
    }

    const result = await this.recordModel.updateOne(filter, { $set: set }).exec();
    if (result.modifiedCount !== 1) {
      throw new ConflictException('تم تعديل هذه الدفعة للتو. حدّث الصفحة ثم أعد المحاولة.');
    }

    const updated: any = await this.recordModel.findById(record._id).exec();
    return {
      message: 'تم إلغاء الدفعة',
      data: updated ? updated.get(section) : null,
    };
  }

  /** Where the payment lives, and the paths needed to update it. */
  private locate(record: any, dto: VoidPaymentDto) {
    const byNumber = (list: any[]) => {
      const index = (list ?? []).findIndex(
        (i: any) => i.installmentNumber === dto.installmentNumber,
      );
      if (index === -1) throw new NotFoundException(`القسط رقم ${dto.installmentNumber} غير موجود`);
      return index;
    };

    switch (dto.section) {
      case 'tuition':
      case 'bus': {
        const installments = record[dto.section]?.installments ?? [];
        const index = byNumber(installments);
        return {
          container: installments[index],
          base: `${dto.section}.installments.${index}`,
          section: dto.section,
          installments,
        };
      }
      case 'trip': {
        const tripIndex = (record.trips ?? []).findIndex(
          (t: any) => String(t._id) === dto.tripId,
        );
        if (tripIndex === -1) throw new NotFoundException('الرحلة غير موجودة');
        const installments = record.trips[tripIndex].installments ?? [];
        const index = byNumber(installments);
        return {
          container: installments[index],
          base: `trips.${tripIndex}.installments.${index}`,
          section: `trips.${tripIndex}`,
          installments,
        };
      }
      case 'additionalFee': {
        const feeIndex = (record.additionalFees ?? []).findIndex(
          (f: any) => String(f.additionalFeeId) === dto.additionalFeeId,
        );
        if (feeIndex === -1) {
          throw new NotFoundException('الرسوم الإضافية غير موجودة في سجل الطالب');
        }
        return {
          container: record.additionalFees[feeIndex],
          base: `additionalFees.${feeIndex}`,
          section: `additionalFees.${feeIndex}`,
          installments: null,
        };
      }
      default:
        throw new BadRequestException('نوع الرسوم غير صالح');
    }
  }

  private async assertCanVoid(target: any, user: { userId: string; role: string; schoolId?: string }) {
    if (user?.role === 'OWNER') return;

    const recordedByMe =
      target.recordedBy && String(target.recordedBy) === String(user?.userId);
    if (!recordedByMe) {
      throw new ForbiddenException(
        'إلغاء الدفعة متاح لمن سجّلها في نفس اليوم، أو لمالك المدرسة.',
      );
    }
    if (!target.recordedAt) {
      throw new ForbiddenException(
        'سُجّلت هذه الدفعة قبل تتبّع وقت التسجيل، ولا يلغيها إلا مالك المدرسة.',
      );
    }

    const timezone = await this.schoolTimezone(user?.schoolId);
    if (PaymentVoidService.dayIn(target.recordedAt, timezone) !== PaymentVoidService.dayIn(new Date(), timezone)) {
      throw new ForbiddenException(
        'انتهى يوم تسجيل هذه الدفعة؛ إلغاؤها الآن يحتاج مالك المدرسة.',
      );
    }
  }

  private async schoolTimezone(fallbackSchoolId?: string): Promise<string> {
    const schoolId = tenantLocalStorage.getStore()?.schoolId ?? fallbackSchoolId;
    if (!schoolId || !mongoose.Types.ObjectId.isValid(String(schoolId))) return DEFAULT_TIMEZONE;
    const school: any = await this.schoolModel
      .findById(schoolId)
      .select('settings.timezone')
      .lean()
      .exec();
    return school?.settings?.timezone || DEFAULT_TIMEZONE;
  }

  /** The calendar date of `date` in `timezone`, as YYYY-MM-DD. */
  static dayIn(date: Date | string, timezone: string): string {
    const format = (tz: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(date));
    try {
      return format(timezone);
    } catch {
      // An unrecognised timezone string in settings must not open the door.
      return format(DEFAULT_TIMEZONE);
    }
  }

  private plain(installment: any) {
    return typeof installment?.toObject === 'function' ? installment.toObject() : installment;
  }
}
