import * as mongoose from 'mongoose';
import { GradesCriteriaService } from './grades-criteria.service';

/**
 * A grade's subjects exist once per term, and the student's subject list
 * returned all of them, so «اللغة العربية AR1» and «الرياضيات MATH1» each
 * appeared once per term of the year.
 *
 * No database: the call is three lookups, and the rule under test is which
 * term survives.
 */
describe('GradesCriteriaService.getMySubjects — one term at a time', () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const gradeLevelId = new mongoose.Types.ObjectId();
  const termOne = new mongoose.Types.ObjectId().toString();
  const termTwo = new mongoose.Types.ObjectId().toString();
  const arabic = new mongoose.Types.ObjectId();
  const maths = new mongoose.Types.ObjectId();

  const offering = (subjectId: mongoose.Types.ObjectId, termId: string) => ({
    _id: new mongoose.Types.ObjectId(),
    subjectId,
    termId: { toString: () => termId },
  });

  const setup = (terms: any[]) => {
    const offerings = [
      offering(arabic, termOne),
      offering(maths, termOne),
      offering(arabic, termTwo),
      offering(maths, termTwo),
    ];
    const service = new GradesCriteriaService(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { find: () => ({ select: () => ({ exec: async () => [{ gradeLevelId }] }) }) } as any,
      {} as any, {} as any, {} as any,
      { find: () => ({ populate: () => ({ exec: async () => offerings }) }) } as any,
      { find: () => ({ select: () => ({ lean: () => ({ exec: async () => terms }) }) }) } as any,
      {} as any, {} as any,
      { resolveClassIds: async () => [new mongoose.Types.ObjectId().toString()] } as any,
    );
    return { service, offerings };
  };

  const day = (offset: number) => new Date(Date.now() + offset * 86400000);

  it('returns the term marked active, one row per subject', async () => {
    const { service } = setup([
      { _id: termOne, status: 'closed' },
      { _id: termTwo, status: 'active' },
    ]);
    const { data } = await service.getMySubjects(studentId);
    expect(data).toHaveLength(2);
    expect(data.every((row: any) => row.termId.toString() === termTwo)).toBe(true);
  });

  it('falls back to the term today sits inside', async () => {
    const { service } = setup([
      { _id: termOne, status: 'closed', startDate: day(-120), endDate: day(-30) },
      { _id: termTwo, status: 'upcoming', startDate: day(-10), endDate: day(50) },
    ]);
    const { data } = await service.getMySubjects(studentId);
    expect(data.map((row: any) => row.termId.toString())).toEqual([termTwo, termTwo]);
  });

  it('falls back to the latest term when none is active and none holds today', async () => {
    const { service } = setup([
      { _id: termOne, status: 'closed', startDate: day(-300), endDate: day(-200), order: 1 },
      { _id: termTwo, status: 'closed', startDate: day(-150), endDate: day(-100), order: 2 },
    ]);
    const { data } = await service.getMySubjects(studentId);
    expect(data.map((row: any) => row.termId.toString())).toEqual([termTwo, termTwo]);
  });

  it('keeps everything when the terms cannot be read, rather than emptying the page', async () => {
    const { service, offerings } = setup([]);
    const { data } = await service.getMySubjects(studentId);
    expect(data).toHaveLength(offerings.length);
  });
});
