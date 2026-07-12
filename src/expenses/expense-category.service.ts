import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { Expense } from './schemas/expense.schema';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';

@Injectable()
export class ExpenseCategoryService {
  constructor(
    @InjectModel(ExpenseCategory.name) private categoryModel: Model<ExpenseCategory>,
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  async create(dto: CreateExpenseCategoryDto, adminId: string) {
    const existing = await this.categoryModel.findOne({ name: dto.name }).lean().exec();
    if (existing) throw new ConflictException('يوجد تصنيف بهذا الاسم بالفعل');

    const data = await this.categoryModel.create({
      ...dto,
      createdBy: new mongoose.Types.ObjectId(adminId),
    });
    return { message: 'تم إنشاء تصنيف المصروفات بنجاح', data };
  }

  async find() {
    const data = await this.categoryModel
      .find()
      .sort({ name: 1 })
      .exec();
    return { message: 'تم استرجاع تصنيفات المصروفات بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'التصنيف');
    const data = await this.categoryModel.findById(id).exec();
    if (!data) throw new NotFoundException('التصنيف غير موجود');
    return { message: 'تم استرجاع التصنيف بنجاح', data };
  }

  async update(id: string, dto: UpdateExpenseCategoryDto) {
    this.validateObjectId(id, 'التصنيف');
    if (dto.name) {
      const existing = await this.categoryModel.findOne({ name: dto.name, _id: { $ne: id } }).lean().exec();
      if (existing) throw new ConflictException('يوجد تصنيف بهذا الاسم بالفعل');
    }
    const data = await this.categoryModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    if (!data) throw new NotFoundException('التصنيف غير موجود');
    return { message: 'تم تعديل التصنيف بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id, 'التصنيف');
    const inUse = await this.expenseModel.exists({ categoryId: new mongoose.Types.ObjectId(id) });
    if (inUse) throw new ConflictException('لا يمكن حذف التصنيف لأنه مرتبط بمصروفات موجودة');
    const data = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('التصنيف غير موجود');
    return { message: 'تم حذف التصنيف بنجاح' };
  }
}
