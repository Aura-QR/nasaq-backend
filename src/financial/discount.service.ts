import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Discount } from './schemas/discount.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { FinancialRecordService } from './financial-record.service';
import { ApplyCustomDiscountDto } from './dto/apply-custom-discount.dto';
import { BulkApplyDiscountDto } from './dto/bulk-apply-discount.dto';
import { entryFrom, recomputeTuitionDiscounts, tuitionEntries } from './discount-calc';

@Injectable()
export class DiscountService {
  constructor(
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    private readonly financialRecordService: FinancialRecordService,
  ) {}

  private validateObjectId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }
  }

  /** What a bus or trip section records: one discount, priced against its fee. */
  private sectionSnapshot(discount: any, fee: number) {
    const entry = entryFrom(discount, fee);
    return { discountId: entry.discountId, name: entry.name, type: entry.type,
      percentage: entry.percentage, amount: entry.amount, discountAmount: entry.discountAmount };
  }

  /**
   * A discount is a percentage (0–100] or a fixed amount (> 0) — never both
   * blank. Normalised so a fixed discount stores percentage 0 and a
   * percentage one stores no amount.
   */
  private normalise(dto: { type?: string; percentage?: number; amount?: number | null }) {
    const type = dto.type === 'fixed' ? 'fixed' : 'percentage';
    if (type === 'fixed') {
      if (!(Number(dto.amount) > 0)) throw new BadRequestException('أدخل مبلغ الخصم بالريال');
      return { type, amount: Math.round(Number(dto.amount)), percentage: 0 };
    }
    const pct = Number(dto.percentage);
    if (!(pct > 0)) throw new BadRequestException('أدخل نسبة الخصم');
    if (pct > 100) throw new BadRequestException('نسبة الخصم لا يمكن أن تتجاوز 100%');
    return { type, percentage: pct, amount: null };
  }

  /** Installments, totals and status follow the new net fee. */
  private rebalance(section: any) {
    this.financialRecordService.rebalanceSection(section);
  }

  async create(dto: CreateDiscountDto, adminId: string) {
    const data = await this.discountModel.create({ ...dto, ...this.normalise(dto), createdBy: adminId });
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
    const current = await this.discountModel.findById(id).exec();
    if (!current) throw new NotFoundException('الخصم غير موجود');
    // Changing the template changes future applications only; discounts
    // already on students keep the value they were given.
    const pricing = ['type', 'percentage', 'amount'].some((k) => (dto as any)[k] !== undefined)
      ? this.normalise({ type: dto.type ?? current.type, percentage: dto.percentage ?? current.percentage,
          amount: dto.amount ?? current.amount })
      : {};
    const data = await this.discountModel.findByIdAndUpdate(id, { ...dto, ...pricing }, { new: true }).exec();
    return { message: 'تم تحديث الخصم بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id);
    const inUse = await this.recordModel.findOne({
      $or: [
        { 'tuition.discount.discountId': new mongoose.Types.ObjectId(id) },
        { 'tuition.discounts.discountId': new mongoose.Types.ObjectId(id) },
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

  /** Re-price the tuition's discounts, rebalance its installments, and save. */
  private async saveTuition(record: StudentFinancialRecord) {
    recomputeTuitionDiscounts(record.tuition);
    this.rebalance(record.tuition);
    record.markModified('tuition');
    await record.save();
  }

  /**
   * Add a discount from the school's list to a student's tuition. Several
   * discounts add up (siblings and returning student); the same one twice
   * does not.
   */
  async applyToTuition(studentId: string, dto: ApplyDiscountDto, adminId?: string) {
    const record = await this.getRecord(studentId, dto.academicYearId);

    const discount = await this.discountModel.findById(dto.discountId).exec();
    if (!discount) throw new NotFoundException('الخصم غير موجود');
    if (!discount.isActive) throw new BadRequestException('هذا الخصم غير نشط');

    const entries = tuitionEntries(record.tuition);
    if (entries.some((e: any) => String(e.discountId ?? '') === String(discount._id))) {
      throw new BadRequestException('هذا الخصم مطبق بالفعل على الطالب');
    }
    const grossFee = record.tuition.grossFee || record.tuition.fee;
    record.tuition.discounts = [...entries,
      entryFrom(discount as any, grossFee, { appliedBy: adminId ? new mongoose.Types.ObjectId(adminId) : null })] as any;
    await this.saveTuition(record);

    return { message: 'تم تطبيق الخصم على الرسوم الدراسية بنجاح', data: record.tuition };
  }

  /**
   * Apply one discount to many students' tuition, e.g. every returning
   * student. Each student is applied on their own: one without a financial
   * record, or who already has this discount, is reported and skipped
   * without stopping the others.
   */
  async applyToTuitionBulk(discountId: string, dto: BulkApplyDiscountDto, adminId?: string) {
    this.validateObjectId(discountId);
    const discount = await this.discountModel.findById(discountId).exec();
    if (!discount) throw new NotFoundException('الخصم غير موجود');
    if (!discount.isActive) throw new BadRequestException('هذا الخصم غير نشط');

    const results = { applied: [] as string[], alreadyHad: [] as string[], noRecord: [] as string[], failed: [] as { studentId: string; message: string }[] };
    for (const studentId of [...new Set(dto.studentIds.map(String))]) {
      try {
        await this.applyToTuition(studentId, { discountId, academicYearId: dto.academicYearId }, adminId);
        results.applied.push(studentId);
      } catch (error: any) {
        const message = String(error?.message ?? '');
        if (message.includes('مطبق بالفعل')) results.alreadyHad.push(studentId);
        else if (message.includes('لا يوجد سجل مالي')) results.noRecord.push(studentId);
        else results.failed.push({ studentId, message: message || 'تعذر تطبيق الخصم' });
      }
    }
    const parts = [`تم تطبيق «${discount.name}» على ${results.applied.length} طالب`];
    if (results.alreadyHad.length) parts.push(`${results.alreadyHad.length} لديهم الخصم بالفعل`);
    if (results.noRecord.length) parts.push(`${results.noRecord.length} بلا سجل مالي`);
    if (results.failed.length) parts.push(`تعذر التطبيق على ${results.failed.length}`);
    return { message: parts.join('، '), data: results };
  }

  /** A discount typed in for this one student, with the reason it was given. */
  async applyCustomToTuition(studentId: string, dto: ApplyCustomDiscountDto, adminId?: string) {
    const record = await this.getRecord(studentId, dto.academicYearId);
    if (dto.type === 'percentage' && dto.value > 100) {
      throw new BadRequestException('نسبة الخصم لا يمكن أن تتجاوز 100%');
    }
    const grossFee = record.tuition.grossFee || record.tuition.fee;
    const entry = entryFrom(
      { name: 'خصم خاص', type: dto.type, percentage: dto.type === 'percentage' ? dto.value : 0,
        amount: dto.type === 'fixed' ? dto.value : null },
      grossFee,
      { reason: dto.reason.trim(), custom: true, appliedBy: adminId ? new mongoose.Types.ObjectId(adminId) : null },
    );
    record.tuition.discounts = [...tuitionEntries(record.tuition), entry] as any;
    await this.saveTuition(record);

    return { message: 'تم تطبيق الخصم الخاص على الرسوم الدراسية بنجاح', data: record.tuition };
  }

  /** Remove one discount from the tuition; the others stay. */
  async removeTuitionEntry(studentId: string, entryId: string, academicYearId?: string) {
    this.validateObjectId(entryId);
    const record = await this.getRecord(studentId, academicYearId);
    const entries = tuitionEntries(record.tuition);
    // A discount applied before tuition carried several has no entry id; its
    // template id identifies it instead.
    const keep = entries.filter((e: any) => String(e._id ?? e.discountId ?? '') !== entryId);
    if (keep.length === entries.length) throw new NotFoundException('الخصم غير موجود على هذا الطالب');
    record.tuition.discounts = keep as any;
    if (!keep.length) record.tuition.discount = null;
    await this.saveTuition(record);

    return { message: 'تم إزالة الخصم من الرسوم الدراسية بنجاح', data: record.tuition };
  }

  /** Remove every discount from the tuition. */
  async removeFromTuition(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);
    record.tuition.discounts = [] as any;
    record.tuition.discount = null;
    await this.saveTuition(record);

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

    const snapshot = this.sectionSnapshot(discount, record.bus.fee);
    const netFee = record.bus.fee - snapshot.discountAmount;

    record.bus.discount = snapshot as any;
    record.bus.netFee = netFee;
    this.rebalance(record.bus);
    record.markModified('bus');
    await record.save();

    return { message: 'تم تطبيق الخصم على رسوم الحافلة بنجاح', data: record.bus };
  }

  async removeFromBus(studentId: string, academicYearId?: string) {
    const record = await this.getRecord(studentId, academicYearId);

    record.bus.discount = null;
    record.bus.netFee = record.bus.fee;
    this.rebalance(record.bus);
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

    const snapshot = this.sectionSnapshot(discount, trip.fee);
    const netFee = trip.fee - snapshot.discountAmount;

    (trip as any).discount = snapshot;
    (trip as any).netFee = netFee;
    this.rebalance(trip);
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
    this.rebalance(trip);
    record.markModified('trips');
    await record.save();

    return { message: 'تم إزالة الخصم من رسوم الرحلة بنجاح', data: trip };
  }
}
