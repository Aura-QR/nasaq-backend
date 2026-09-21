import { LessonObservationsService } from './lesson-observations.service';

/**
 * Telling the supervisor who has clocked in.
 *
 * Walking a corridor, they cannot know. Without it they write a teacher up
 * for reaching the fourth period late when that teacher never came in at all,
 * and the notice goes to somebody sitting at home.
 *
 * A signal, never a lock. The supervisor is standing in front of the room and
 * a missing row in a table is weaker evidence than their eyes.
 */
describe('The round and the clock-in sheet', () => {
  const present = '60d5ecb8b5c9c22b8c8b4001';
  const absent = '60d5ecb8b5c9c22b8c8b4002';

  const lecture = (teacherId: string | null, slot = 1) => ({
    _id: `lec-${teacherId ?? 'none'}-${slot}`,
    slot,
    dayOfWeek: 'sunday',
    classId: { name: 'رابع/بنات' },
    teacherId: teacherId ? { _id: teacherId, name: 'معلمة' } : null,
    subjectOfferingId: { subjectId: { subjectName: 'الرياضيات' } },
  });

  const build = (lectures: any[], checkIns: any[]) => {
    const chain = (value: any) => ({
      find: () => chain(value),
      populate: () => chain(value),
      select: () => chain(value),
      sort: () => chain(value),
      lean: () => chain(value),
      exec: async () => value,
    });

    return new LessonObservationsService(
      chain([]) as any,                       // observations
      chain(lectures) as any,                 // lectures
      { findOne: () => chain(null) } as any,  // term
      chain([]) as any,                       // substitutions
      chain(checkIns) as any,                 // teacher attendance
      {} as any,                              // admins
      { notify: jest.fn() } as any,
    );
  };

  // 2026-09-20 is a Sunday.
  const SUNDAY = '2026-09-20';

  const roundOf = async (lectures: any[], checkIns: any[]) => {
    const result = await build(lectures, checkIns).round(SUNDAY, {});
    return result.data;
  };

  it('marks the teacher who clocked in and the one who did not', async () => {
    const data = await roundOf(
      [lecture(present, 1), lecture(absent, 2)],
      [{ teacherId: present }],
    );

    const [first, second] = data.items;
    expect(first.teacherCheckedIn).toBe(true);
    expect(second.teacherCheckedIn).toBe(false);
  });

  it('says nothing on a morning nobody has clocked in yet', async () => {
    // Otherwise the first supervisor out at 06:30 sees the whole staff
    // flagged, which is noise rather than information — and a screen that
    // cries wolf on every row is one nobody reads.
    const data = await roundOf([lecture(present, 1), lecture(absent, 2)], []);

    expect(data.checkInInUse).toBe(false);
    expect(data.items.every((item: any) => item.teacherCheckedIn === null)).toBe(true);
  });

  it('says nothing about a lesson with no teacher on it', async () => {
    // A joint gym session or an unstaffed subject: nobody is expected, so
    // "did not clock in" would be an accusation with no subject.
    const data = await roundOf([lecture(null, 3)], [{ teacherId: present }]);
    expect(data.items[0].teacherCheckedIn).toBeNull();
  });

  it('reports it alongside the round, not instead of it', async () => {
    // The signal is one field on a row the supervisor was already reading.
    const data = await roundOf([lecture(absent, 1)], [{ teacherId: present }]);

    expect(data.total).toBe(1);
    expect(data.visited).toBe(0);
    expect(data.items[0].className).toBe('رابع/بنات');
  });
});
