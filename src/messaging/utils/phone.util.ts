/**
 * Turning what a school typed into a number WhatsApp will accept.
 *
 * `Student.phoneNumber` and `Teacher.phoneNumber` are free text. Nothing has
 * ever validated them, so the collection holds every shape a human produces:
 *   0501234567   +966 50 123 4567   00966501234567   ٠٥٠١٢٣٤٥٦٧   050-123-4567
 *
 * Evolution API wants one shape — E.164 digits with no `+` — and answers a
 * wrong one with a 400 that reads like a server fault. Normalising here means
 * a bad number is caught before it is queued, and shows up as a delivery the
 * school can see and fix rather than a message that quietly never arrives.
 */

/** ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ are digits too, and phones get pasted in both. */
function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * @param raw    whatever the school typed
 * @param defaultCountryCode  digits only, no `+` — e.g. '966', '20'
 * @returns E.164 digits without `+`, or null if it cannot be made into one
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode = '966',
): string | null {
  if (!raw) return null;

  const cc = String(defaultCountryCode).replace(/\D/g, '');
  const text = toAsciiDigits(String(raw)).trim();
  if (!text) return null;

  let international = text.startsWith('+');
  let digits = text.replace(/\D/g, '');

  // 00 is the other way of writing +
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }

  if (!international) {
    if (cc && digits.startsWith(cc) && digits.length >= cc.length + 8) {
      // already carries the country code, just written without the +
    } else if (digits.startsWith('0')) {
      digits = cc + digits.replace(/^0+/, '');
    } else if (cc) {
      digits = cc + digits;
    }
  }

  // E.164 tops out at 15 digits; nothing shorter than 10 is a reachable
  // international number.
  if (digits.length < 10 || digits.length > 15) return null;

  return digits;
}

/** `9665…` -> `+966 5…` — for showing an owner what we actually dialled. */
export function displayPhone(normalized: string): string {
  return `+${normalized}`;
}
