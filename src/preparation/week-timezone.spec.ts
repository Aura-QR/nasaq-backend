import { currentWeekOf, startOfWeek, toDateOnlyString } from './utils/week.util';

/**
 * Which week a teacher is shown when she does not name one.
 *
 * A supervisor reported that some teachers were seeing last week's
 * preparation. They had prepared the week of 27 September – 1 October and the
 * screen kept showing the week before it.
 *
 * The server runs on UTC; the schools are in Riyadh, three hours ahead. So
 * from midnight to 03:00 Riyadh the two disagree about the date — and on a
 * Saturday, the day the school week is anchored on, that disagreement crosses
 * a week boundary. `currentWeekOf()` took the server's date, landed on a day
 * that was still Friday in UTC, and anchored to the *previous* Saturday.
 *
 * The teachers who saw it were the ones who opened the app early; the ones who
 * opened it after 3am saw the right week, which is why it looked like it only
 * affected "some" of them.
 */
describe('currentWeekOf — the week the school is actually in', () => {
  const at = (iso: string) => toDateOnlyString(currentWeekOf(new Date(iso)));

  describe('Saturday, the day the week turns over', () => {
    // 2026-09-26 is a Saturday. In Riyadh the new week starts at 00:00 local,
    // which is 21:00 UTC on Friday the 25th.
    it('is already the new week at 00:30 in Riyadh', () => {
      // The exact regression: this returned 2026-09-19 before the fix.
      expect(at('2026-09-25T21:30:00Z')).toBe('2026-09-26');
    });

    it('is the new week at 02:59 in Riyadh, the last minute of the gap', () => {
      expect(at('2026-09-25T23:59:00Z')).toBe('2026-09-26');
    });

    it('is the new week once UTC agrees, at 03:30 Riyadh', () => {
      // This one was always correct, which is why the bug looked intermittent.
      expect(at('2026-09-26T00:30:00Z')).toBe('2026-09-26');
    });

    it('is still the new week during the school day', () => {
      expect(at('2026-09-26T05:00:00Z')).toBe('2026-09-26');
    });
  });

  describe('Friday, the last day of the week', () => {
    it('stays on the old week at 22:00 Riyadh Friday', () => {
      // 2026-09-25T19:00Z is Friday 22:00 in Riyadh — still last week, and
      // the fix must not push it forward.
      expect(at('2026-09-25T19:00:00Z')).toBe('2026-09-19');
    });

    it('stays on the old week at 00:30 Riyadh Friday', () => {
      // Thursday 21:30 UTC is Friday 00:30 Riyadh: the same UTC-vs-local gap,
      // but on a day that must NOT move the week.
      expect(at('2026-09-24T21:30:00Z')).toBe('2026-09-19');
    });
  });

  describe('the week the teachers actually prepared', () => {
    // 27 Sept – 1 Oct, the range the supervisor named. It crosses a month
    // boundary, which is the kind of thing that breaks naive arithmetic.
    const prepared = [
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ];

    it('files every day of it under one week', () => {
      const weeks = new Set(
        prepared.map((d) => toDateOnlyString(startOfWeek(d))),
      );
      expect([...weeks]).toEqual(['2026-09-26']);
    });

    it('is the week a teacher sees on the Saturday it opens', () => {
      expect(at('2026-09-25T21:00:00Z')).toBe('2026-09-26');
    });

    it('is still the week on the Thursday it ends', () => {
      // 2026-10-01T05:00Z is Thursday 08:00 in Riyadh.
      expect(at('2026-10-01T05:00:00Z')).toBe('2026-09-26');
    });

    it('has rolled over by the next Saturday', () => {
      expect(at('2026-10-02T21:30:00Z')).toBe('2026-10-03');
    });
  });

  describe('a week that crosses into a new year', () => {
    it('anchors on the Saturday even across 31 December', () => {
      // 2027-01-01 is a Friday; its week opened Saturday 2026-12-26.
      expect(toDateOnlyString(startOfWeek('2027-01-01'))).toBe('2026-12-26');
    });
  });
});
