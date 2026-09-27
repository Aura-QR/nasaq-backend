import { PreparationContentService } from './preparation-content.service';

/**
 * Which classes a student is allowed to read a preparation for.
 *
 * A student opened a lesson from their own timetable and got «التحضير غير
 * موجود» — on every lesson, not one. The timetable and this filter read the
 * student's class from two different places: GET /lectures/student/me builds
 * the schedule from `student.classId`, while this filter listed only the
 * classes on their enrolment rows.
 *
 * In production those disagreed. The student had four active enrolments and
 * a `classId` that was in none of them, and all seven preparations on their
 * schedule belonged to that one class — so the schedule offered them and the
 * filter refused every one.
 *
 * Taking the union is the safe reading: both are the school's own record of
 * where the student sits, and either alone locks them out of work meant for
 * them. The class must still match, so nothing outside the student's own
 * classes is opened up.
 */
describe('studentFilter — the classes a student may read', () => {
  const studentId = '6a86a40c4263edb4e1220b1c';

  const build = (enrolledIn: string[], ownClass: string | null) => {
    const enrollments = {
      find: () => ({
        select: () => ({
          lean: async () => enrolledIn.map((classId) => ({ classId })),
        }),
      }),
      exists: async () => enrolledIn.length > 0,
    };

    const students = {
      findById: () => ({
        select: () => ({
          lean: async () => (ownClass ? { classId: ownClass } : null),
        }),
      }),
    };

    // Constructor order: preparations, resources, lessons, units, offerings,
    // library, exams, projects, enrollments, students.
    const service = new PreparationContentService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      enrollments as any,
      students as any,
    );

    return service.studentFilter({ userId: studentId, role: 'STUDENT' });
  };

  const classesOf = (filter: any) =>
    filter.classId.$in.map((c: any) => String(c));

  it('includes a classId that is in none of the enrolments', async () => {
    // The exact production case: four enrolments, and the class the
    // timetable is built from is not among them.
    const filter = await build(
      ['6a8ed4b2e0af6256209e58e3', '6a86a1604263edb4e1220a17'],
      '6a86a1244263edb4e12209f8',
    );

    expect(classesOf(filter)).toContain('6a86a1244263edb4e12209f8');
  });

  it('keeps the enrolled classes as well', async () => {
    // The fix must widen, not replace — a student reading lessons for their
    // enrolled classes must keep doing so.
    const filter = await build(
      ['6a8ed4b2e0af6256209e58e3', '6a86a1604263edb4e1220a17'],
      '6a86a1244263edb4e12209f8',
    );

    expect(classesOf(filter)).toEqual(
      expect.arrayContaining([
        '6a8ed4b2e0af6256209e58e3',
        '6a86a1604263edb4e1220a17',
        '6a86a1244263edb4e12209f8',
      ]),
    );
  });

  it('still works for a student with enrolments and no classId', async () => {
    const filter = await build(['6a8ed4b2e0af6256209e58e3'], null);
    expect(classesOf(filter)).toEqual(['6a8ed4b2e0af6256209e58e3']);
  });

  it('still works for a legacy student with only a classId', async () => {
    // The case the old fallback existed for; it must not regress.
    const filter = await build([], '6a86a1244263edb4e12209f8');
    expect(classesOf(filter)).toEqual(['6a86a1244263edb4e12209f8']);
  });

  it('does not list the same class twice when both sources agree', async () => {
    // The ordinary student: enrolled in the class their classId names.
    const filter = await build(
      ['6a8ed4b2e0af6256209e58e1'],
      '6a8ed4b2e0af6256209e58e1',
    );

    expect(classesOf(filter)).toEqual(['6a8ed4b2e0af6256209e58e1']);
  });

  it('opens nothing when the student has no class at all', async () => {
    // An empty $in matches nothing, which is the correct refusal — not an
    // accidental "everything".
    const filter = await build([], null);
    expect(classesOf(filter)).toEqual([]);
  });

  it('still withholds drafts', async () => {
    // Widening the classes must not widen the status: a draft is the
    // teacher's unfinished work and stays hidden.
    const filter = await build(['6a8ed4b2e0af6256209e58e1'], null);
    expect(filter.reviewStatus).toEqual({ $in: ['pending', 'approved'] });
  });
});
