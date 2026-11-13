import { ratingOf } from './ministry-template';

describe('التقدير (ratingOf)', () => {
  it('names each band at its edges', () => {
    expect(ratingOf(100)?.label).toBe('ممتاز');
    expect(ratingOf(90)?.key).toBe('excellent');
    expect(ratingOf(89.99)?.key).toBe('very_good');
    expect(ratingOf(80)?.key).toBe('very_good');
    expect(ratingOf(79.5)?.key).toBe('good');
    expect(ratingOf(70)?.key).toBe('good');
    expect(ratingOf(69)?.key).toBe('acceptable');
    expect(ratingOf(50)?.key).toBe('acceptable');
    expect(ratingOf(49.99)?.label).toBe('غير مجتاز');
  });

  it("uses the subject's own pass mark: 55 fails when the pass is 60", () => {
    expect(ratingOf(55, 60)?.key).toBe('failed');
    expect(ratingOf(60, 60)?.key).toBe('acceptable');
    expect(ratingOf(55, null)?.key).toBe('acceptable');
  });

  it('has no rating without a number', () => {
    expect(ratingOf(null)).toBeNull();
    expect(ratingOf(undefined)).toBeNull();
    expect(ratingOf(NaN)).toBeNull();
    expect(ratingOf(0)?.key).toBe('failed');
  });
});
