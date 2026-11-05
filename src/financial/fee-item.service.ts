import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { FeeItem } from './schemas/fee-item.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { CreateFeeItemDto, SellFeeItemDto, UpdateFeeItemDto } from './dto/fee-item.dto';

/**
 * Items sold by the piece (uniform), priced in the settings.
 *
 * A sale becomes a charge on the student's record beside the additional fees,
 * so it is paid through the same «سداد» as they are: each sale gets its own
 * `additionalFeeId`, which is what the pay endpoint looks charges up by.
 */
@Injectable()
export class FeeItemService {
  constructor(
    @InjectModel(FeeItem.name) private readonly items: Model<FeeItem>,
    @InjectModel(StudentFinancialRecord.name) private readonly records: Model<StudentFinancialRecord>,
  ) {}

  private oid(id: string, label = 'المعرف') {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new BadRequestException(`صيغة ${label} غير صحيحة`);
    return new mongoose.Types.ObjectId(id);
  }

  async create(dto: CreateFeeItemDto, adminId?: string) {
    const name = dto.name.trim();
    if (await this.items.exists({ name })) throw new BadRequestException(`يوجد بند باسم «${name}» بالفعل`);
    const data = await this.items.create({ ...dto, name, createdBy: adminId ? this.oid(adminId) : null });
    return { message: 'تمت إضافة البند بنجاح', data };
  }

  async find() {
    const data = await this.items.find().sort({ isActive: -1, name: 1 }).lean();
    return { message: 'تم استرجاع البنود بنجاح', data };
  }

  /** A new price applies to sales from now on; past sales keep theirs. */
  async update(id: string, dto: UpdateFeeItemDto) {
    const update: any = { ...dto };
    if (dto.name !== undefined) {
      update.name = dto.name.trim();
      if (await this.items.exists({ name: update.name, _id: { $ne: this.oid(id) } })) {
        throw new BadRequestException(`يوجد بند باسم «${update.name}» بالفعل`);
      }
    }
    const data = await this.items.findByIdAndUpdate(this.oid(id), update, { new: true }).lean();
    if (!data) throw new NotFoundException('البند غير موجود');
    return { message: 'تم تحديث البند بنجاح', data };
  }

  /** Only an item never sold can be deleted; a sold one is deactivated instead. */
  async delete(id: string) {
    const itemId = this.oid(id);
    if (await this.records.exists({ 'additionalFees.feeItemId': itemId })) {
      throw new BadRequestException('لا يمكن حذف بند بيع لطلاب — أوقف تفعيله بدلًا من ذلك');
    }
    const data = await this.items.findByIdAndDelete(itemId).lean();
    if (!data) throw new NotFoundException('البند غير موجود');
    return { message: 'تم حذف البند بنجاح' };
  }

  private async record(studentId: string, academicYearId?: string) {
    const query: any = { studentId: this.oid(studentId, 'الطالب') };
    if (academicYearId) query.academicYearId = this.oid(academicYearId, 'العام الدراسي');
    const record = await this.records.findOne(query).sort({ createdAt: -1 }).exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');
    return record;
  }

  /** Charge the student quantity × today's price; optionally record it paid. */
  async sell(itemId: string, studentId: string, dto: SellFeeItemDto, adminId: string) {
    const item = await this.items.findById(this.oid(itemId, 'البند')).lean();
    if (!item) throw new NotFoundException('البند غير موجود');
    if (!item.isActive) throw new BadRequestException('هذا البند غير مفعّل');
    const record = await this.record(studentId, dto.academicYearId);

    const amount = Math.round(item.unitPrice * dto.quantity * 100) / 100;
    const paid = Boolean(dto.paidAt);
    const entry: any = {
      additionalFeeId: new mongoose.Types.ObjectId(),
      feeItemId: item._id,
      name: dto.quantity > 1 ? `${item.name} × ${dto.quantity}` : item.name,
      description: dto.notes?.trim() || item.description || '',
      amount,
      quantity: dto.quantity,
      unitPrice: item.unitPrice,
      soldAt: new Date(),
      status: paid ? 'paid' : 'unpaid',
      paidAmount: paid ? amount : 0,
      payments: paid
        ? [{ amount, paidAt: new Date(dto.paidAt), recordedAt: new Date(), recordedBy: this.oid(adminId), notes: dto.notes?.trim() || '' }]
        : [],
    };
    record.additionalFees.push(entry);
    record.markModified('additionalFees');
    await record.save();
    return {
      message: paid ? `تم تسجيل ${entry.name} بمبلغ ${amount} ريال وسداده` : `تمت إضافة ${entry.name} بمبلغ ${amount} ريال إلى مستحقات الطالب`,
      data: record.additionalFees[record.additionalFees.length - 1],
    };
  }

  /** Undo a sale entered by mistake — only while nothing has been paid on it. */
  async cancelSale(studentId: string, saleId: string, academicYearId?: string) {
    const record = await this.record(studentId, academicYearId);
    const sale: any = record.additionalFees.find((f: any) => String(f.additionalFeeId) === saleId && f.feeItemId);
    if (!sale) throw new NotFoundException('عملية البيع غير موجودة');
    if (sale.status === 'paid' || Number(sale.paidAmount) > 0) {
      throw new BadRequestException('لا يمكن إلغاء بيع مسدد — ألغِ الدفعة أولًا');
    }
    record.additionalFees = record.additionalFees.filter((f: any) => String(f.additionalFeeId) !== saleId) as any;
    record.markModified('additionalFees');
    await record.save();
    return { message: 'تم إلغاء عملية البيع' };
  }
}
