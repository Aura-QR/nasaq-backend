import { findHoliday, resolveDaySchedule } from './attendance.utils';

/**
 * Days off the weekly schedule cannot express.
 *
 * `workSchedule` answers "is Friday a working day", which is the right
 * question for a Friday and the wrong one for Eid. Without holidays a
 * mid-term break counted as absence against every teacher in the school, and
 * the monthly report measured everyone against days nobody was asked to come
 * in on.
 *
 * This is checked in `resolveDaySchedule` rather than at each call site
 * because every question of the form "is this a working day" already goes
 * through it — the absentee list, the monthly report, teacher check-in and
 * staff check-in. Handling it once is the only way all four agree.
 */
describe('A declared holiday', () => {
  const week = () =>
    [
      ['sunday', true], ['monday', true], ['tuesday', true],
      ['wednesday', true], ['thursday', true],
      ['friday', false], ['saturday', false],
    ].map(([day, isWorkingDay]) => ({
      day,
      isWorkingDay,
      startTime: isWorkingDay ? '06:45' : null,
      endTime: isWorkingDay ? '13:00' : null,
    }));

  const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  const settings = (holidays: any[]) => ({ workSchedule: week(), holidays });

  /** 2026-09-20 is a Sunday, 2026-09-25 a Friday. */
  const midTerm = [
    { name: 'إجازة منتصف الفصل', startDate: '2026-09-21', endDate: '2026-09-23' },
  ];

  describe('closing a day', () => {
    it('closes a working day inside the range', () => {
      const day = resolveDaySchedule(settings(midTerm), at('2026-09-22'));
      expect(day.isWorkingDay).toBe(false);
    });

    it('closes the first and last day of the range', () => {
      // An exclusive end is the classic off-by-one here, and it hands every
      // teacher one day of absence they did not earn.
      expect(resolveDaySchedule(settings(midTerm), at('2026-09-21')).isWorkingDay)
        .toBe(false);
      expect(resolveDaySchedule(settings(midTerm), at('2026-09-23')).isWorkingDay)
        .toBe(false);
    });

    it('leaves the day before and the day after alone', () => {
      expect(resolveDaySchedule(settings(midTerm), at('2026-09-20')).isWorkingDay)
        .toBe(true);
      expect(resolveDaySchedule(settings(midTerm), at('2026-09-24')).isWorkingDay)
        .toBe(true);
    });

    it('takes the hours off the day too', () => {
      // A closed day with a start time still on it would compute lateness
      // against a morning nobody was asked to attend.
      const day = resolveDaySchedule(settings(midTerm), at('2026-09-22'));
      expect(day.startTime).toBeNull();
      expect(day.endTime).toBeNull();
      expect(day.expectedWorkMinutes).toBeNull();
    });

    it('names itself', () => {
      // "إجازة" on a Tuesday reads as a broken schedule. The name is the
      // difference between an answer and a shrug.
      const day = resolveDaySchedule(settings(midTerm), at('2026-09-22'));
      expect(day.holidayName).toBe('إجازة منتصف الفصل');
    });
  });

  describe('a single day', () => {
    it('is a range whose ends are equal', () => {
      const national = [
        { name: 'اليوم الوطني', startDate: '2026-09-23', endDate: '2026-09-23' },
      ];
      expect(resolveDaySchedule(settings(national), at('2026-09-23')).isWorkingDay)
        .toBe(false);
      expect(resolveDaySchedule(settings(national), at('2026-09-24')).isWorkingDay)
        .toBe(true);
    });
  });

  describe('closing a school with no schedule at all', () => {
    it('still works', () => {
      // A school that never configured its week treats every day as a working
      // day. Checking the holiday after the schedule would skip these
      // entirely — which is most schools on the day they first set this up.
      const day = resolveDaySchedule({ holidays: midTerm }, at('2026-09-22'));
      expect(day.isWorkingDay).toBe(false);
      expect(day.holidayName).toBe('إجازة منتصف الفصل');
    });
  });

  describe('a school with none declared', () => {
    it('behaves exactly as it did before holidays existed', () => {
      expect(resolveDaySchedule(settings([]), at('2026-09-22')).isWorkingDay).toBe(true);
      expect(resolveDaySchedule({ workSchedule: week() }, at('2026-09-22')).isWorkingDay)
        .toBe(true);
      expect(resolveDaySchedule(settings([]), at('2026-09-25')).isWorkingDay).toBe(false);
    });

    it('reports no holiday name on an ordinary weekend', () => {
      // A Friday is a day off, not a holiday. Labelling it one would put
      // "إجازة" beside every weekend in every report.
      const friday = resolveDaySchedule(settings([]), at('2026-09-25'));
      expect(friday.isWorkingDay).toBe(false);
      expect(friday.holidayName).toBeNull();
    });
  });

  describe('reading a list that is not clean', () => {
    it('survives a range entered backwards', () => {
      // The service straightens these on save, but a row written before that
      // existed must not silently stop closing its days.
      const reversed = [
        { name: 'إجازة', startDate: '2026-09-23', endDate: '2026-09-21' },
      ];
      expect(resolveDaySchedule(settings(reversed), at('2026-09-22')).isWorkingDay)
        .toBe(false);
    });

    it('skips a row with no dates rather than closing everything', () => {
      const broken = [{ name: 'إجازة', startDate: null, endDate: null }];
      expect(resolveDaySchedule(settings(broken) as any, at('2026-09-22')).isWorkingDay)
        .toBe(true);
    });

    it('skips an unreadable date', () => {
      const broken = [{ name: 'إجازة', startDate: 'yesterday', endDate: 'soon' }];
      expect(resolveDaySchedule(settings(broken), at('2026-09-22')).isWorkingDay)
        .toBe(true);
    });

    it('falls back to a generic name when none was given', () => {
      const unnamed = [
        { name: '   ', startDate: '2026-09-22', endDate: '2026-09-22' },
      ];
      expect(resolveDaySchedule(settings(unnamed), at('2026-09-22')).holidayName)
        .toBe('إجازة');
    });

    it('finds the right one when several are declared', () => {
      const many = [
        { name: 'إجازة أولى', startDate: '2026-09-21', endDate: '2026-09-22' },
        { name: 'إجازة ثانية', startDate: '2026-10-01', endDate: '2026-10-05' },
      ];
      expect(findHoliday(settings(many), at('2026-10-03'))?.name).toBe('إجازة ثانية');
      expect(findHoliday(settings(many), at('2026-09-30'))).toBeNull();
    });
  });
});
