import { LecturesService } from './lectures.service';
import { startOfWeek, toDateOnlyString } from '../preparation/utils/week.util';

/**
 * Which preparation a student's timetable hands back.
 *
 * `Lecture.preparation` accumulates — every preparation ever filed for that
 * period, across every week, pushed in creation order. Both clients read
 * `preparation[0]` and open it, which was right only while a period had been
 * prepared once.
 *
 * It stopped being right the moment a teacher prepared a period for two
 * weeks. Found in production on Monday period 1:
 *
 *   ['6ab8b886… (3 Oct, draft)', '6ab90c24… (26 Sept, submitted)']
 *
 * The student got the draft — and students cannot read drafts — so a lesson
 * she could have read answered «التحضير غير موجود». Note the order: the array
 * is not sorted by week, so "take the first" is not even "take the oldest".
 *
 * These run without a database: the models are stubs, and what is asserted is
 * the resolution itself.
 */
describe('a student timetable and the week it is asked for', () => {
  const OCT = '6ab8b886dca1903de96f216b'; // 3 Oct
  const SEPT = '6ab90c24ee20d4db490c73e1'; // 26 Sept

  /** weekOf -> the preparations filed for it. */
  const BY_WEEK: Record<string, string[]> = {
    '2026-10-03': [OCT],
    '2026-09-26': [SEPT],
  };

  const build = (lectures: any[]) => {
    const preparationModel = {
      find: (filter: any) => {
        const week = toDateOnlyString(filter.weekOf);
        const wanted = new Set(filter._id.$in.map(String));
        const rows = (BY_WEEK[week ?? ''] ?? [])
          .filter((id) => wanted.has(id))
          .map((id) => ({ _id: id }));
        return { select: () => ({ lean: () => ({ exec: async () => rows }) }) };
      },
    };

    const studentModel = {
      findById: () => ({
        select: () => ({ exec: async () => ({ classId: 'class-1' }) }),
      }),
    };

    const service = new LecturesService(
      { find: () => ({ exec: async () => lectures }) } as any,
      {} as any,
      {} as any,
      studentModel as any,
      {} as any,
      {} as any,
      { findOne: () => ({ select: () => ({ exec: async () => null }) }) } as any,
      preparationModel as any,
    );

    // findAll does the populate chain; the week resolution is what is under
    // test, so it is stubbed to hand back the lectures as given.
    (service as any).findAll = async () => lectures;

    return service;
  };

  const period = (preparation: string[]) => ({
    _id: 'lecture-1',
    dayOfWeek: 'monday',
    slot: 1,
    preparation,
  });

  const weekOf = (lectures: any[], week?: string) =>
    build(lectures)
      .findMyStudentLectures('student-1', 'term-1', week)
      .then((rows: any[]) => rows[0].preparation);

  describe('a period prepared for two weeks', () => {
    // The exact production array, in the order it is stored.
    const both = [OCT, SEPT];

    it('gives the week that was asked for, not the first in the array', async () => {
      expect(await weekOf([period(both)], '2026-09-26')).toEqual([SEPT]);
    });

    it('gives the other week when that is the one asked for', async () => {
      expect(await weekOf([period(both)], '2026-10-03')).toEqual([OCT]);
    });

    it('accepts any day of the week, not only its Saturday', async () => {
      // A client sends the day the student is looking at; the server anchors
      // it. Monday 28 September belongs to the week of the 26th.
      expect(await weekOf([period(both)], '2026-09-28')).toEqual([SEPT]);
    });

    it('gives nothing for a week with no preparation', async () => {
      expect(await weekOf([period(both)], '2026-11-07')).toEqual([]);
    });
  });

  describe('the ordinary cases', () => {
    it('keeps a period prepared for exactly the week asked for', async () => {
      expect(await weekOf([period([SEPT])], '2026-09-26')).toEqual([SEPT]);
    });

    it('drops a preparation belonging to a different week', async () => {
      // Before this, the timetable offered the lesson and opening it failed.
      expect(await weekOf([period([SEPT])], '2026-10-03')).toEqual([]);
    });

    it('leaves an unprepared period alone', async () => {
      expect(await weekOf([period([])], '2026-09-26')).toEqual([]);
    });

    it('returns the lectures untouched when none are prepared', async () => {
      // No ids to look up, so no query — and the rows must still come back.
      const rows: any = await build([period([])]).findMyStudentLectures(
        'student-1',
        'term-1',
        '2026-09-26',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].slot).toBe(1);
    });
  });

  describe('the week itself', () => {
    it('anchors a requested day to its Saturday', () => {
      // The same rule the preparation service uses, so a timetable and a
      // lesson cannot disagree about which week a day belongs to.
      expect(toDateOnlyString(startOfWeek('2026-09-28'))).toBe('2026-09-26');
      expect(toDateOnlyString(startOfWeek('2026-10-05'))).toBe('2026-10-03');
    });
  });
});
