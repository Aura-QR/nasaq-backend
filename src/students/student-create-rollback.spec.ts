import { BadRequestException } from '@nestjs/common';
import { StudentsService } from './students.service';

/**
 * A student who is saved stays saved.
 *
 * A school owner added several girls to أولى متوسط, went back to the class,
 * and found it empty. Nothing had deleted them: creating each one had deleted
 * itself. `create()` saved the student, saved the enrolment, then asked the
 * finance module for a record — and on failure ran
 *
 *     findOneAndDelete(enrolment)
 *     findByIdAndDelete(student)
 *     throw
 *
 * There is no soft delete and no audit trail in this system, so the row was
 * simply gone. The office read the error as "it did not go through" and typed
 * the student again, which erased itself again. The only trace left was the
 * global students_counter, which had climbed once per attempt and left a
 * burnt number behind each time.
 *
 * A missing fee configuration is a gap in the finance setup. It is not a
 * reason to refuse an enrolment and it is certainly not a reason to destroy
 * one. These tests run without a database: the models are stubs, so what is
 * asserted is the control flow itself — which is where the bug lived.
 */
describe('StudentsService.create — when the financial record cannot be built', () => {
  const classId = '6a987dd3e503d8f0db825dae';
  const schoolId = '6a7064396923f767d2086314';
  const academicYearId = '6a85913e5760c8cd1405d93d';

  let deletedStudents: any[];
  let deletedEnrolments: any[];
  let savedStudent: any;

  const build = (financialOutcome: () => Promise<void>) => {
    deletedStudents = [];
    deletedEnrolments = [];

    const exec = (value: any = null) => ({ exec: async () => value });

    savedStudent = {
      _id: 'student-1',
      schoolId,
      name: 'سارة علي',
      phoneNumber: '0500000000',
      schoolEmail: 'au260001@student.auraschool.com',
      toObject() {
        return { ...this };
      },
    };

    // `new this.studentModel(fields)` must return something saveable.
    const studentModel: any = function () {
      return { ...savedStudent, save: async () => savedStudent };
    };
    studentModel.findOne = async () => null;
    studentModel.findById = () => exec(savedStudent);
    studentModel.findByIdAndDelete = (id: any) => {
      deletedStudents.push(id);
      return exec(null);
    };

    const classModel = {
      findById: () =>
        exec({
          _id: classId,
          schoolId,
          academicYearId,
          gradeLevelId: 'grade-1',
        }),
    };

    const enrollmentModel = {
      findOneAndUpdate: () => exec({ _id: 'enrolment-1' }),
      findOneAndDelete: (filter: any) => {
        deletedEnrolments.push(filter);
        return exec(null);
      },
    };

    const counterModel = {
      findOne: async () => null,
      findOneAndUpdate: async () => ({ count: 1, year: '26' }),
    };

    const financialRecordService = {
      createOrUpdateRecord: financialOutcome,
    };

    const enqueue = jest.fn().mockResolvedValue(null);

    const service = new StudentsService(
      studentModel,
      classModel as any,
      counterModel as any,
      enrollmentModel as any,
      {} as any,
      {} as any,
      financialRecordService as any,
      {} as any,
      { enqueue } as any,
    );

    return { service, enqueue };
  };

  const dto = () => ({
    firstName: 'سارة',
    fatherName: 'علي',
    familyName: 'أحمد',
    gender: 'female',
    classId,
  });

  const missingFeeConfig = () =>
    Promise.reject(
      new BadRequestException('لا يوجد إعداد رسوم للصف الأول متوسط'),
    );

  it('keeps the student instead of deleting her', async () => {
    // The exact regression. Before the fix this list held 'student-1'.
    const { service } = build(missingFeeConfig);

    await service.create(dto() as any);

    expect(deletedStudents).toEqual([]);
  });

  it('keeps the enrolment, so the class is not silently emptied', async () => {
    const { service } = build(missingFeeConfig);

    await service.create(dto() as any);

    expect(deletedEnrolments).toEqual([]);
  });

  it('does not throw, so the office is not told the save failed', async () => {
    // The throw is what made the owner retry, and every retry erased itself.
    const { service } = build(missingFeeConfig);

    await expect(service.create(dto() as any)).resolves.toBeDefined();
  });

  it('reports what is still missing rather than failing silently', async () => {
    // Keeping the student is only half of it: somebody has to know the
    // financial record was not created, or it is found at invoicing time.
    const { service } = build(missingFeeConfig);

    const result: any = await service.create(dto() as any);

    expect(result.data.financialRecordWarning).toContain('إعداد رسوم');
    expect(result.message).toBe(
      'تم إضافة الطالب بنجاح، ولم يتم إنشاء السجل المالي',
    );
  });

  it('still delivers the login details to the guardian', async () => {
    // These were never sent on the failing path, because the throw came
    // first — so even a student who survived would not have had credentials.
    const { service, enqueue } = build(missingFeeConfig);

    await service.create(dto() as any);

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('says nothing about finance when the record is built normally', async () => {
    // The ordinary path must stay quiet; a warning on every creation trains
    // the office to ignore warnings.
    const { service } = build(() => Promise.resolve());

    const result: any = await service.create(dto() as any);

    expect(result.data.financialRecordWarning).toBeUndefined();
    expect(result.message).toBe('تم إضافة الطالب بنجاح');
  });

  it('survives a finance failure that is not a BadRequestException', async () => {
    // A dropped connection reaches the same catch, and must not reopen the
    // path that deletes people.
    const { service } = build(() => Promise.reject(new Error('ECONNRESET')));

    const result: any = await service.create(dto() as any);

    expect(deletedStudents).toEqual([]);
    expect(result.data.financialRecordWarning).toBe('ECONNRESET');
  });
});
