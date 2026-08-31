/**
 * Matching names that a human typed into a spreadsheet.
 *
 * An import is pasted from Excel, so the same teacher appears as "أ/ فاطمة",
 * "أ. فاطمة" and "فاطمة  الدهاسي" across three rows. Comparing those raw finds
 * nothing and the import reports the whole sheet as unknown.
 *
 * Normalisation is deliberately conservative: it folds the variations that are
 * always the same name (orthographic alef forms, diacritics, honorifics,
 * spacing) and nothing that could merge two different people.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * "أ/", "أ.", "أ ", "الأستاذة", "م/" and friends at the start of a name.
 *
 * The single-letter forms must be followed by a separator or a space. Without
 * that condition a bare `ا` matches the first letter of an ordinary word, and
 * "اسلامية" normalises to "سلاميه" — every subject and surname beginning with
 * alef silently loses it.
 */
const HONORIFICS = new RegExp(
  '^\\s*(?:' +
    // full words: unambiguous, no trailing condition needed
    '(?:الأستاذة|الاستاذة|الأستاذ|الاستاذ|المعلمة|المعلم)\\s*[/.\\-]?\\s*' +
    '|' +
    // single letters: only an honorific when punctuation or a space follows
    '(?:[أاامد])\\s*[/.\\-]\\s*' +
    '|' +
    '(?:[أامد])\\s+' +
  ')',
);

export function normalizeArabicName(value: unknown): string {
  let text = String(value ?? '').trim();
  if (!text) return '';

  text = text.replace(DIACRITICS, '').replace(TATWEEL, '');
  text = text.replace(HONORIFICS, '');

  text = text
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');

  // Collapse every run of whitespace, including the non-breaking spaces Excel
  // likes to paste.
  text = text.replace(/[\s ​-‏]+/g, ' ').trim();

  return text.toLowerCase();
}

export interface NameMatch<T> {
  match: T | null;
  ambiguous: T[];
}

/**
 * Finds the one record whose name matches. Several matches are reported rather
 * than resolved: guessing which "أحمد" a row meant is how an import quietly
 * assigns a class to the wrong teacher.
 */
export function matchByName<T>(
  needle: string,
  candidates: T[],
  nameOf: (item: T) => string,
): NameMatch<T> {
  const target = normalizeArabicName(needle);
  if (!target) return { match: null, ambiguous: [] };

  const exact = candidates.filter(
    (item) => normalizeArabicName(nameOf(item)) === target,
  );
  if (exact.length === 1) return { match: exact[0], ambiguous: [] };
  if (exact.length > 1) return { match: null, ambiguous: exact };

  // Fall back to a containment match so "فاطمة" finds "فاطمة الدهاسي" — but
  // only when it picks out exactly one person.
  const partial = candidates.filter((item) => {
    const name = normalizeArabicName(nameOf(item));
    return name.includes(target) || target.includes(name);
  });
  if (partial.length === 1) return { match: partial[0], ambiguous: [] };
  return { match: null, ambiguous: partial };
}

/**
 * Splits a pasted block into rows of cells.
 *
 * Accepts what a spreadsheet actually produces on paste — tabs — as well as
 * the separators people type by hand: comma, pipe, semicolon, or a run of
 * spaces before a trailing number.
 */
export function parseRows(text: string): { line: number; cells: string[]; raw: string }[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter((row) => row.raw.trim() !== '' && !row.raw.trim().startsWith('#'))
    .map((row) => {
      let cells: string[];
      if (/[\t|;,]/.test(row.raw)) {
        cells = row.raw.split(/[\t|;,]/);
      } else {
        // "رياضيات 6" — the trailing number is its own cell.
        const trailing = row.raw.trim().match(/^(.*?)\s+(\d+)$/);
        cells = trailing ? [trailing[1], trailing[2]] : [row.raw];
      }
      return {
        line: row.line,
        raw: row.raw.trim(),
        cells: cells.map((c) => c.trim()).filter((c) => c !== ''),
      };
    });
}

/**
 * Reads a count out of a pasted cell.
 *
 * Returns null rather than a number when the cell holds no digits at all.
 * Stripping non-digits and calling Number() looks equivalent and is not:
 * Number('') is 0, so a cell reading "كتير" became "0 periods" — and 0 means
 * unplanned, so the subject silently vanished from the timetable instead of
 * raising an error.
 *
 * Arabic-Indic digits are accepted: an Arabic Excel writes ٦, not 6.
 */
export function parseCount(value: unknown): number | null {
  const text = String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  const digits = text.match(/\d+/);
  if (!digits) return null;

  const parsed = Number(digits[0]);
  return Number.isInteger(parsed) ? parsed : null;
}
