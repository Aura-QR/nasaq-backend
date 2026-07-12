import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Expense } from './schemas/expense.schema';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class ExpenseService {
  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(ExpenseCategory.name) private categoryModel: Model<ExpenseCategory>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  async create(dto: CreateExpenseDto, adminId: string) {
    this.validateObjectId(dto.categoryId, 'التصنيف');
    const category = await this.categoryModel.findById(dto.categoryId).lean().exec();
    if (!category) throw new NotFoundException('التصنيف غير موجود');

    const data = await this.expenseModel.create({
      ...dto,
      categoryId: new mongoose.Types.ObjectId(dto.categoryId),
      date: new Date(dto.date),
      createdBy: new mongoose.Types.ObjectId(adminId),
    });
    return { message: 'تم إضافة المصروف بنجاح', data };
  }

  async find(filters: any = {}, pagination: any = {}) {
    const query: any = {};

    if (filters.categoryId && mongoose.Types.ObjectId.isValid(filters.categoryId)) {
      query.categoryId = new mongoose.Types.ObjectId(filters.categoryId);
    }
    if (filters.academicYear) {
      query.academicYear = filters.academicYear;
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
      .populate('categoryId', 'name');

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

    const updatePayload: any = { ...dto };
    if (dto.categoryId) updatePayload.categoryId = new mongoose.Types.ObjectId(dto.categoryId);
    if (dto.date) updatePayload.date = new Date(dto.date);

    const data = await this.expenseModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .populate('categoryId', 'name')
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
