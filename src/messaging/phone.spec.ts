import { normalizePhone, displayPhone } from './utils/phone.util';

/**
 * The shapes a Saudi school actually types into a phone field. Every one of
 * these was reachable before this util existed and none of them was a number
 * Evolution API would accept.
 */
describe('normalizePhone', () => {
  describe('Saudi numbers (default country 966)', () => {
    const cases: Array<[string, string]> = [
      ['0501234567', '966501234567'],
      ['+966501234567', '966501234567'],
      ['00966501234567', '966501234567'],
      ['966501234567', '966501234567'],
      ['501234567', '966501234567'],
      ['050-123-4567', '966501234567'],
      ['050 123 4567', '966501234567'],
      ['(050) 1234567', '966501234567'],
      ['+966 50 123 4567', '966501234567'],
    ];

    it.each(cases)('%s -> %s', (input, expected) => {
      expect(normalizePhone(input)).toBe(expected);
    });
  });

  it('reads Arabic-Indic digits, which is how a number pasted from a phone arrives', () => {
    expect(normalizePhone('٠٥٠١٢٣٤٥٦٧')).toBe('966501234567');
    expect(normalizePhone('۰۵۰۱۲۳۴۵۶۷')).toBe('966501234567');
  });

  it('applies the country code it is given, not a hardcoded one', () => {
    expect(normalizePhone('01001234567', '20')).toBe('201001234567');
    expect(normalizePhone('+201001234567', '20')).toBe('201001234567');
    expect(normalizePhone('0501234567', '971')).toBe('971501234567');
  });

  it('leaves a foreign number that already carries its own country code alone', () => {
    // A teacher hired from Egypt, stored in a Saudi school.
    expect(normalizePhone('+201001234567', '966')).toBe('201001234567');
    expect(normalizePhone('00201001234567', '966')).toBe('201001234567');
  });

  describe('refuses what cannot be dialled', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'whitespace'],
      ['12345', 'too short'],
      ['—', 'no digits at all'],
      ['0000000000000000000', 'too long for E.164'],
    ])('%s (%s)', (input) => {
      expect(normalizePhone(input)).toBeNull();
    });

    it('null and undefined', () => {
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
    });
  });

  it('is idempotent — normalising an already-normalised number changes nothing', () => {
    const once = normalizePhone('0501234567')!;
    expect(normalizePhone(once)).toBe(once);
  });

  it('displayPhone puts the + back for a human', () => {
    expect(displayPhone('966501234567')).toBe('+966501234567');
  });
});
