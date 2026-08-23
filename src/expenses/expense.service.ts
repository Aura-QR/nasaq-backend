import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Expense } from './schemas/expense.schema';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { AcademicYear } from '../academic-years/schemas/academic-year.schema';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class ExpenseService {
  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(ExpenseCategory.name) private categoryModel: Model<ExpenseCategory>,
    @InjectModel(AcademicYear.name) private academicYearModel: Model<AcademicYear>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  /*
   * Turn whatever the caller sent into the ObjectId the schema stores.
   *
   * Three inputs, in order of preference:
   *   academicYearId — the id, what the field has always been.
   *   academicYear   — the NAME ('2025-2026'). The old DTO declared this and
   *                    the schema never had a matching path, so mongoose
   *                    dropped it on save and every expense was written with
   *                    academicYearId: null. Resolved by lookup now, and kept
   *                    only so the deployed web client keeps working.
   *   neither        — the school's active year, because an expense with no
   *                    year cannot be reported on.
   *
   * Returns undefined only when the school has no active year at all, which
   * leaves the schema default (null) in place rather than failing the write.
   */
  private async resolveAcademicYearId(
    academicYearId?: string,
    academicYearName?: string,
  ): Promise<mongoose.Types.ObjectId | undefined> {
    if (academicYearId) {
      this.validateObjectId(academicYearId, 'العام الدراسي');
      const year = await this.academicYearModel.findById(academicYearId).lean().exec();
      if (!year) throw new NotFoundException('العام الدراسي غير موجود');
      return new mongoose.Types.ObjectId(academicYearId);
    }

    if (academicYearName?.trim()) {
      const year = await this.academicYearModel
        .findOne({ name: academicYearName.trim() })
        .lean()
        .exec();
      if (!year) throw new NotFoundException('العام الدراسي غير موجود');
      return new mongoose.Types.ObjectId(String(year._id));
    }

    const active = await this.academicYearModel.findOne({ status: 'active' }).lean().exec();
    return active ? new mongoose.Types.ObjectId(String(active._id)) : undefined;
  }

  async create(dto: CreateExpenseDto, adminId: string) {
    this.validateObjectId(dto.categoryId, 'التصنيف');
    const category = await this.categoryModel.findById(dto.categoryId).lean().exec();
    if (!category) throw new NotFoundException('التصنيف غير موجود');

    const academicYearId = await this.resolveAcademicYearId(
      dto.academicYearId,
      dto.academicYear,
    );

    // academicYear is spread in from the DTO and would be dropped by mongoose
    // anyway; strip it so the saved document holds only real schema paths.
    const { academicYear: _deprecated, ...rest } = dto;

    const created = await this.expenseModel.create({
      ...rest,
      categoryId: new mongoose.Types.ObjectId(dto.categoryId),
      date: new Date(dto.date),
      academicYearId: academicYearId ?? null,
      createdBy: new mongoose.Types.ObjectId(adminId),
    });

    // Read it back populated: the client renders the year straight from the
    // create response instead of refetching the list.
    const data = await this.expenseModel
      .findById(created._id)
      .populate('categoryId', 'name')
      .populate('academicYearId', 'name status')
      .exec();

    return { message: 'تم إضافة المصروف بنجاح', data };
  }

  async find(filters: any = {}, pagination: any = {}) {
    const query: any = {};

    if (filters.categoryId && mongoose.Types.ObjectId.isValid(filters.categoryId)) {
      query.categoryId = new mongoose.Types.ObjectId(filters.categoryId);
    }

    /*
     * The filter accepts an id or a name, matching what create accepts.
     * It used to set query.academicYear — a path no expense document has —
     * so filtering by year always returned an empty list with a 200.
     */
    if (filters.academicYearId && mongoose.Types.ObjectId.isValid(filters.academicYearId)) {
      query.academicYearId = new mongoose.Types.ObjectId(filters.academicYearId);
    } else if (filters.academicYear) {
      const raw = String(filters.academicYear).trim();
      if (mongoose.Types.ObjectId.isValid(raw)) {
        query.academicYearId = new mongoose.Types.ObjectId(raw);
      } else {
        const year = await this.academicYearModel.findOne({ name: raw }).lean().exec();
        // An unknown name must match nothing, not everything.
        query.academicYearId = year ? new mongoose.Types.ObjectId(String(year._id)) : null;
      }
    }

    if (filters.name) {
      query.name = { $regex: String(filters.name).trim(), $options: 'i' };
    }
    if (filters.dateFrom || filters.dateTo) {
      query.date = {};
      if (filters.dateFrom) query.date.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.date.$lte = new Date(filters.dateTo);
    }

    const total = await this.expenseModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginated = pagination.page !== undefined || pagination.limit !== undefined;

    let q = this.expenseModel
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .populate('categoryId', 'name')
      .populate('academicYearId', 'name status');

    if (isPaginated) q = q.skip(paginationMeta.skip).limit(paginationMeta.limit);
    const data = await q.exec();

    if (isPaginated) {
      return {
        message: 'تم استرجاع المصروفات بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }
    return { message: 'تم استرجاع المصروفات بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'المصروف');
    const data = await this.expenseModel
      .findById(id)
      .populate('categoryId', 'name description')
      .populate('academicYearId', 'name status')
      .exec();
    if (!data) throw new NotFoundException('المصروف غير موجود');
    return { message: 'تم استرجاع المصروف بنجاح', data };
  }

  async update(id: string, dto: UpdateExpenseDto) {
    this.validateObjectId(id, 'المصروف');
    if (dto.categoryId) {
      this.validateObjectId(dto.categoryId, 'التصنيف');
      const category = await this.categoryModel.findById(dto.categoryId).lean().exec();
      if (!category) throw new NotFoundException('التصنيف غير موجود');
    }

    const { academicYear, academicYearId, ...rest } = dto;
    const updatePayload: any = { ...rest };
    if (dto.categoryId) updatePayload.categoryId = new mongoose.Types.ObjectId(dto.categoryId);
    if (dto.date) updatePayload.date = new Date(dto.date);

    // Only touch the year when the caller actually sent one — an update of the
    // amount alone must not silently move the expense to the active year.
    if (academicYearId || academicYear?.trim()) {
      updatePayload.academicYearId = await this.resolveAcademicYearId(
        academicYearId,
        academicYear,
      );
    }

    const data = await this.expenseModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .populate('categoryId', 'name')
      .populate('academicYearId', 'name status')
      .exec();
    if (!data) throw new NotFoundException('المصروف غير موجود');
    return { message: 'تم تعديل المصروف بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id, 'المصروف');
    const data = await this.expenseModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('المصروف غير موجود');
    return { message: 'تم حذف المصروف بنجاح' };
  }
}
