import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';

/**
 * The offering a teacher sets new work on, checked to be current.
 *
 * Deleting an academic year leaves its offerings, timetable and teacher
 * assignments behind, and the teacher's forms still list them. An exam set on
 * one went to last year's classes, so this year's students never saw it. Its
 * term must still exist and, when the school has an active year, belong to it.
 * A closed term of this year is allowed — a make-up paper is set after it.
 */
export async function loadCurrentOffering(
  offeringModel: Model<any>,
  academicYearModel: Model<any> | undefined,
  offeringId: string,
) {
  const offering: any = await offeringModel
    .findById(offeringId)
    .populate('termId', 'academicYearId')
    .exec();
  if (!offering) {
    throw new NotFoundException('المادة غير موجودة في هذا الصف والفصل الدراسي');
  }
  const term = offering.termId;
  if (!term?._id) {
    throw new BadRequestException('هذه المادة تابعة لفصل دراسي محذوف؛ اختر مادة الفصل الدراسي الحالي');
  }
  const active = academicYearModel
    ? await academicYearModel.findOne({ status: 'active' }).select('_id').lean().exec()
    : null;
  if (active && String(term.academicYearId) !== String((active as any)._id)) {
    throw new BadRequestException('هذه المادة تابعة لعام دراسي غير العام الحالي؛ اختر مادة العام الدراسي الحالي');
  }
  return offering;
}
