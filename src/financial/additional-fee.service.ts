import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { AdditionalFee, AdditionalFeeTarget } from './schemas/additional-fee.schema';
import { StudentFinancialRecord } from './schemas/student-financial-record.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { CreateAdditionalFeeDto } from './dto/create-additional-fee.dto';
import { PaymentStatus } from './enums/payment-status.enum';

@Injectable()
export class AdditionalFeeService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
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
        return [new mongoose.Types.ObjectId(dto.targetId)];
      }

      case AdditionalFeeTarget.CLASS: {
        if (!dto.targetId) throw new BadRequestException('targetId مطلوب عند الاستهداف بفصل');
        this.validateObjectId(dto.targetId, 'الفصل');
        const cls = await this.classModel.findById(dto.targetId).lean().exec();
        if (!cls) throw new NotFoundException('الفصل غير موجود');
        return (cls as any).studentIds.map((id: any) => new mongoose.Types.ObjectId(id));
      }

      case AdditionalFeeTarget.ACADEMIC_YEAR: {
        if (!dto.targetAcademicYear) throw new BadRequestException('targetAcademicYear مطلوب عند الاستهداف بسنة دراسية');
        const classes = await this.classModel.find({ academicYear: dto.targetAcademicYear }).lean().exec();
        const ids = classes.flatMap((c: any) => c.studentIds.map((id: any) => new mongoose.Types.ObjectId(id)));
        return [...new Map(ids.map(id => [id.toString(), id])).values()];
      }

      case AdditionalFeeTarget.SCHOOL: {
        const students = await this.studentModel.find({}, { _id: 1 }).lean().exec();
        return students.map((s: any) => new mongoose.Types.ObjectId(s._id));
      }
    }
  }

  async create(dto: CreateAdditionalFeeDto, adminId: string) {
    const studentIds = await this.getAffectedStudentIds(dto);
    if (studentIds.length === 0) throw new BadRequestException('لا يوجد طلاب في النطاق المحدد');

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const [fee] = await this.additionalFeeModel.create(
        [{
          ...dto,
          targetId: dto.targetId ? new mongoose.Types.ObjectId(dto.targetId) : null,
          createdBy: new mongoose.Types.ObjectId(adminId),
        }],
        { session },
      );

      const entry = {
        additionalFeeId: fee._id,
        name: fee.name,
        description: fee.description,
        amount: fee.amount,
        status: 'unpaid',
        paidAmount: 0,
        payments: [],
      };

      await this.recordModel.updateMany(
        { studentId: { $in: studentIds } },
        { $push: { additionalFees: entry } },
        { session },
      );

      await session.commitTransaction();

      return {
        message: `تم إنشاء الرسوم الإضافية وإضافتها لـ ${studentIds.length} طالب`,
        data: fee,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
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

  async pay(studentId: string, feeId: string, amount: number, paidAt: string, adminId: string, notes?: string) {
    this.validateObjectId(studentId, 'الطالب');
    this.validateObjectId(feeId, 'الرسوم');

    const record = await this.recordModel
      .findOne({ studentId: new mongoose.Types.ObjectId(studentId) })
      .exec();
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
