import { BadRequestException } from '@nestjs/common';
import { computeLateMinutes, parseCheckInTime } from './attendance.utils';

/**
 * A time typed on the admin screen ("07:45") is wall-clock time where the
 * school is. It used to be read as UTC, so in Riyadh a 07:45 arrival was saved
 * as 10:45 and reported 195 minutes late against a 07:30 start.
 */
describe('parseCheckInTime', () => {
  const day = new Date('2026-09-14T00:00:00.000Z');

  it('reads HH:mm in the school timezone, not UTC', () => {
    const instant = parseCheckInTime(day, '07:45', 'Asia/Riyadh');
    expect(instant.toISOString()).toBe('2026-09-14T04:45:00.000Z');
    expect(computeLateMinutes(instant, '07:30', 'Asia/Riyadh')).toBe(15);
  });

  it('accepts the calendar date as a string too', () => {
    expect(parseCheckInTime('2026-09-14', '07:45', 'Asia/Riyadh').toISOString()).toBe('2026-09-14T04:45:00.000Z');
  });

  it('keeps an ISO instant with an offset exactly as sent', () => {
    expect(parseCheckInTime(day, '2026-09-14T04:45:00.000Z', 'Asia/Riyadh').toISOString()).toBe(
      '2026-09-14T04:45:00.000Z',
    );
    expect(parseCheckInTime(day, '2026-09-14T07:45:00+03:00', 'Asia/Riyadh').toISOString()).toBe(
      '2026-09-14T04:45:00.000Z',
    );
  });

  it('reads an offset-less ISO time in the school timezone as well', () => {
    expect(parseCheckInTime(day, '2026-09-14T07:45:00', 'Asia/Riyadh').toISOString()).toBe(
      '2026-09-14T04:45:00.000Z',
    );
  });

  it('follows the offset of the date itself across daylight saving', () => {
    // New York: UTC-4 in September, UTC-5 in January.
    expect(parseCheckInTime('2026-09-14', '07:45', 'America/New_York').toISOString()).toBe('2026-09-14T11:45:00.000Z');
    expect(parseCheckInTime('2026-01-14', '07:45', 'America/New_York').toISOString()).toBe('2026-01-14T12:45:00.000Z');
  });

  it.each([
    ['the table text a broken dialog used to send', '07:45 ص'],
    ['an hour past 23', '25:00'],
    ['an empty string', ''],
    ['a date that does not exist', '2026-02-30T07:45:00Z'],
    ['free text', 'soon'],
  ])('refuses %s with a 400 instead of saving Invalid Date', (_label, value) => {
    expect(() => parseCheckInTime(day, value, 'Asia/Riyadh')).toThrow(BadRequestException);
  });

  it('refuses a non-string', () => {
    expect(() => parseCheckInTime(day, 745 as any, 'Asia/Riyadh')).toThrow(BadRequestException);
  });
});
