import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { AdditionalFee, AdditionalFeeTarget } from './schemas/additional-fee.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { CreateAdditionalFeeDto } from './dto/create-additional-fee.dto';

@Injectable()
export class AdditionalFeeService {
  constructor(
    @InjectModel(AdditionalFee.name) private additionalFeeModel: Model<AdditionalFee>,
    @InjectModel(StudentFinancialRecord.name) private recordModel: Model<StudentFinancialRecord>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Class.name) private classModel: Model<Class>,
  ) {}

  private validateObjectId(id: string, name = 'المعرف'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة ${name} غير صحيحة`);
    }
  }

  private async getAffectedStudentIds(dto: CreateAdditionalFeeDto): Promise<mongoose.Types.ObjectId[]> {
    switch (dto.targetType) {
      case AdditionalFeeTarget.STUDENT: {
        if (!dto.targetId) throw new BadRequestException('targetId مطلوب عند الاستهداف بطالب');
        this.validateObjectId(dto.targetId, 'الطالب');
        const student = await this.studentModel.findById(dto.targetId).lean().exec();
        if (!student) throw new NotFoundException('الطالب غير موجود');
        return [new mongoose.Types.ObjectId(dto.targetId)];
      }

      case AdditionalFeeTarget.CLASS: {
        if (!dto.targetId) throw new BadRequestException('targetId مطلوب عند الاستهداف بفصل');
        this.validateObjectId(dto.targetId, 'الفصل');
        const cls = await this.classModel.findById(dto.targetId).lean().exec();
        if (!cls) throw new NotFoundException('الفصل غير موجود');
        const students = await this.studentModel
          .find({ classId: new mongoose.Types.ObjectId(dto.targetId) }, { _id: 1 })
          .lean()
          .exec();
        return students.map((s: any) => new mongoose.Types.ObjectId(s._id));
      }

      case AdditionalFeeTarget.ACADEMIC_YEAR: {
        const yearParam = dto.targetId || dto.targetAcademicYear;
        if (!yearParam) throw new BadRequestException('targetId مطلوب عند الاستهداف بسنة دراسية (أرسل معرف السنة الدراسية في targetId)');
        if (!mongoose.Types.ObjectId.isValid(yearParam)) {
          throw new BadRequestException('معرف السنة الدراسية غير صحيح — أرسل ObjectId الخاص بالسنة الدراسية في حقل targetId');
        }
        const classFilter = { academicYearId: new mongoose.Types.ObjectId(yearParam) };
        const classes = await this.classModel.find(classFilter, { _id: 1 }).lean().exec();
        const classIds = classes.map((c: any) => c._id);
        if (classIds.length === 0) return [];
        const students = await this.studentModel
          .find({ classId: { $in: classIds } }, { _id: 1 })
          .lean()
          .exec();
        return students.map((s: any) => new mongoose.Types.ObjectId(s._id));
      }

      case AdditionalFeeTarget.SCHOOL:
      case AdditionalFeeTarget.ALL: {
        const students = await this.studentModel.find({}, { _id: 1 }).lean().exec();
        return students.map((s: any) => new mongoose.Types.ObjectId(s._id));
      }

      default: {
        throw new BadRequestException('نوع الاستهداف غير مدعوم');
      }
    }
  }

  async create(dto: CreateAdditionalFeeDto, adminId: string) {
    const existing = await this.additionalFeeModel.findOne({ name: dto.name }).lean().exec();
    if (existing) {
      throw new BadRequestException(`رسوم إضافية باسم "${dto.name}" موجودة مسبقاً — استخدم اسماً مختلفاً`);
    }

    const studentIds = await this.getAffectedStudentIds(dto);
    if (studentIds.length === 0) throw new BadRequestException('لا يوجد طلاب في النطاق المحدد');

    const targetIdObj = (dto.targetId && mongoose.Types.ObjectId.isValid(dto.targetId))
      ? new mongoose.Types.ObjectId(dto.targetId)
      : null;

    const fee = await this.additionalFeeModel.create({
      ...dto,
      targetId: targetIdObj,
      createdBy: new mongoose.Types.ObjectId(adminId),
    });

    const entry = {
      additionalFeeId: fee._id,
      name: fee.name,
      description: fee.description,
      amount: fee.amount,
      status: 'unpaid',
      paidAmount: 0,
      payments: [],
    };

    try {
      await this.recordModel.updateMany(
        { studentId: { $in: studentIds } },
        { $push: { additionalFees: entry } },
      );
    } catch (err) {
      await this.additionalFeeModel.findByIdAndDelete(fee._id).exec();
      throw err;
    }

    return {
      message: `تم إنشاء الرسوم الإضافية وإضافتها لـ ${studentIds.length} طالب`,
      data: fee,
    };
  }

  async find() {
    const data = await this.additionalFeeModel.find().sort({ createdAt: -1 }).exec();
    return { message: 'تم استرجاع الرسوم الإضافية بنجاح', data };
  }

  async findOne(id: string) {
    this.validateObjectId(id);
    const data = await this.additionalFeeModel.findById(id).exec();
    if (!data) throw new NotFoundException('الرسوم الإضافية غير موجودة');
    return { message: 'تم استرجاع الرسوم الإضافية بنجاح', data };
  }

  async delete(id: string) {
    this.validateObjectId(id);
    const data = await this.additionalFeeModel.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('الرسوم الإضافية غير موجودة');
    await this.recordModel.updateMany(
      {},
      { $pull: { additionalFees: { additionalFeeId: new mongoose.Types.ObjectId(id) } } },
    );
    return { message: 'تم حذف الرسوم الإضافية وإزالتها من سجلات الطلاب' };
  }

  async pay(
    studentId: string,
    feeId: string,
    amount: number,
    paidAt: string,
    adminId: string,
    notes?: string,
    academicYearId?: string,
  ) {
    this.validateObjectId(studentId, 'الطالب');
    this.validateObjectId(feeId, 'الرسوم');

    const query: any = { studentId: new mongoose.Types.ObjectId(studentId) };
    if (academicYearId) {
      this.validateObjectId(academicYearId, 'العام الدراسي');
      query.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }

    const record = await this.recordModel.findOne(query).sort({ createdAt: -1 }).exec();
    if (!record) throw new NotFoundException('لا يوجد سجل مالي لهذا الطالب');

    const fee = record.additionalFees.find(f => (f as any).additionalFeeId.toString() === feeId);
    if (!fee) throw new NotFoundException('الرسوم الإضافية غير موجودة في سجل الطالب');
    if (fee.status === 'paid') throw new BadRequestException('تم سداد هذه الرسوم بالفعل');
    if (amount !== fee.amount) throw new BadRequestException(`المبلغ الصحيح هو ${fee.amount} جنيه`);

    (fee.payments as any[]).push({
      amount,
      paidAt: new Date(paidAt),
      recordedBy: new mongoose.Types.ObjectId(adminId),
      notes,
    });
    fee.paidAmount = amount;
    fee.status = 'paid';

    record.markModified('additionalFees');
    await record.save();

    return { message: 'تم تسجيل الدفعة بنجاح', data: fee };
  }
}
