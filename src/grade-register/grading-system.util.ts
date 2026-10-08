import { BadRequestException } from '@nestjs/common';
import { Connection, Types } from 'mongoose';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { GradingSystem } from './ministry-template';

/** The current school's grading system; 'flexible' when unset or unknown. */
export async function gradingSystemOf(conn: Connection | undefined, schoolId?: string | null): Promise<GradingSystem> {
  const id = schoolId ?? tenantLocalStorage.getStore()?.schoolId;
  const School = conn?.models?.['School'];
  if (!id || !School || !Types.ObjectId.isValid(String(id))) return 'flexible';
  const school: any = await School.findById(id)
    .select('settings.gradingSystem')
    .setOptions({ skipTenantScope: true })
    .lean()
    .exec();
  return school?.settings?.gradingSystem === 'ministry' ? 'ministry' : 'flexible';
}

/**
 * The grading system cannot change once marks exist in the active year.
 *
 * The two systems read different things — «معايير الدرجات» on one side,
 * the annual register on the other — so switching mid-year would silently
 * change every student's mark for work already done.
 */
export async function assertGradingSystemMayChange(conn: Connection, schoolId: string): Promise<void> {
  const sid = new Types.ObjectId(String(schoolId));
  const col = (model: string) => conn.models[model]?.collection ?? null;
  const year: any = await col('AcademicYear')?.findOne({ schoolId: sid, status: 'active' }, { projection: { _id: 1 } });
  if (!year) return;
  const termIds = ((await col('Term')?.find({ schoolId: sid, academicYearId: year._id }, { projection: { _id: 1 } }).toArray()) ?? [])
    .map((t: any) => t._id);
  const offeringIds = ((await col('SubjectOffering')?.find({ schoolId: sid, termId: { $in: termIds } }, { projection: { _id: 1 } }).toArray()) ?? [])
    .map((o: any) => o._id);
  if (!offeringIds.length) return;

  const examIds = ((await col('Exam')?.find({ schoolId: sid, subjectOfferingId: { $in: offeringIds } }, { projection: { _id: 1 } }).toArray()) ?? [])
    .map((e: any) => e._id);
  const projectIds = ((await col('Project')?.find({ schoolId: sid, subjectOfferingId: { $in: offeringIds } }, { projection: { _id: 1 } }).toArray()) ?? [])
    .map((p: any) => p._id);

  const marked =
    (examIds.length && (await col('ExamResult')?.countDocuments({ examId: { $in: examIds }, achievedGrade: { $ne: null } }))) ||
    (projectIds.length && (await col('ProjectSubmission')?.countDocuments({ projectId: { $in: projectIds }, achievedGrade: { $ne: null } }))) ||
    (await col('GradeRegisterSheet')?.countDocuments({
      schoolId: sid,
      subjectOfferingId: { $in: offeringIds },
      $or: [{ status: 'approved' }, { 'finalMarks.0': { $exists: true } }, { 'writtenItems.marks.0': { $exists: true } }],
    })) ||
    (await col('DailyTracking')?.countDocuments({ schoolId: sid, subjectOfferingId: { $in: offeringIds }, quizScore: { $ne: null } }));

  if (marked) {
    throw new BadRequestException(
      'لا يمكن تغيير نظام الدرجات بعد رصد درجات في العام الدراسي الحالي؛ يُغيَّر قبل بداية العام',
    );
  }
}
