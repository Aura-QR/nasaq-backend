import { normalizeArabicName, matchByName, parseRows, parseCount } from './arabic-name.util';

describe('name matching for pasted sheets', () => {
  describe('normalizeArabicName', () => {
    it('folds the honorifics a sheet writes a teacher under', () => {
      const forms = ['أ/ فاطمة', 'أ. فاطمة', 'أ فاطمة', 'الأستاذة فاطمة', 'فاطمة'];
      const normalized = forms.map(normalizeArabicName);
      expect(new Set(normalized).size).toBe(1);
    });

    it('folds alef spellings', () => {
      expect(normalizeArabicName('أحمد')).toBe(normalizeArabicName('احمد'));
      expect(normalizeArabicName('إسلامية')).toBe(normalizeArabicName('اسلامية'));
    });

    it('does not eat the alef that starts an ordinary word', () => {
      // A bare `ا` is only an honorific when punctuation or a space follows.
      // Treating it as one turns "اسلامية" into "سلاميه" and "الرياضيات" into
      // "لرياضيات" — every alef-initial name silently mangled.
      expect(normalizeArabicName('اسلامية')).toBe('اسلاميه');
      expect(normalizeArabicName('الرياضيات')).toBe('الرياضيات');
      expect(normalizeArabicName('أحمد')).toBe('احمد');
      expect(normalizeArabicName('املاء')).toBe('املاء');
      expect(normalizeArabicName('دراسات إسلامية')).toBe('دراسات اسلاميه');
      expect(normalizeArabicName('محمد')).toBe('محمد');
    });

    it('folds ta marbuta and alef maqsura', () => {
      expect(normalizeArabicName('تربية')).toBe(normalizeArabicName('تربيه'));
      expect(normalizeArabicName('لغتى')).toBe(normalizeArabicName('لغتي'));
    });

    it('collapses the spacing Excel pastes', () => {
      expect(normalizeArabicName('فاطمة   الدهاسي')).toBe('فاطمه الدهاسي');
      expect(normalizeArabicName('  فاطمة الدهاسي  ')).toBe('فاطمه الدهاسي');
    });

    it('strips diacritics and tatweel', () => {
      expect(normalizeArabicName('رِيَاضِيَّات')).toBe(normalizeArabicName('رياضيات'));
      expect(normalizeArabicName('عــلوم')).toBe(normalizeArabicName('علوم'));
    });
  });

  describe('matchByName', () => {
    const teachers = [
      { name: 'فاطمة الدهاسي' },
      { name: 'جيهان العتيبي' },
      { name: 'مروة العتيبي' },
    ];

    it('finds a teacher written with an honorific', () => {
      expect(matchByName('أ/ فاطمة الدهاسي', teachers, (t) => t.name).match?.name)
        .toBe('فاطمة الدهاسي');
    });

    it('finds a teacher by first name alone when it is unambiguous', () => {
      expect(matchByName('جيهان', teachers, (t) => t.name).match?.name)
        .toBe('جيهان العتيبي');
    });

    it('reports an ambiguous surname rather than guessing', () => {
      // Handing a class to the wrong العتيبي is much harder to notice than an
      // error line.
      const result = matchByName('العتيبي', teachers, (t) => t.name);
      expect(result.match).toBeNull();
      expect(result.ambiguous).toHaveLength(2);
    });

    it('returns nothing for a name that is not there', () => {
      const result = matchByName('سعاد', teachers, (t) => t.name);
      expect(result.match).toBeNull();
      expect(result.ambiguous).toHaveLength(0);
    });

    it('ignores an empty cell', () => {
      expect(matchByName('   ', teachers, (t) => t.name).match).toBeNull();
    });
  });

  describe('parseRows', () => {
    it('reads a tab-separated paste from Excel', () => {
      const rows = parseRows('لغتي\t6\nرياضيات\t6');
      expect(rows).toHaveLength(2);
      expect(rows[0].cells).toEqual(['لغتي', '6']);
    });

    it('reads pipes, commas and semicolons', () => {
      expect(parseRows('لغتي | 6')[0].cells).toEqual(['لغتي', '6']);
      expect(parseRows('لغتي, 6')[0].cells).toEqual(['لغتي', '6']);
      expect(parseRows('لغتي; 6')[0].cells).toEqual(['لغتي', '6']);
    });

    it('reads a trailing number with no separator at all', () => {
      expect(parseRows('تربية فنية 1')[0].cells).toEqual(['تربية فنية', '1']);
    });

    it('skips blank lines and comments', () => {
      const rows = parseRows('# الخطة\nلغتي\t6\n\n\nرياضيات\t6\n');
      expect(rows).toHaveLength(2);
      expect(rows[0].line).toBe(2); // line numbers stay true to the paste
      expect(rows[1].line).toBe(5);
    });

    it('keeps the raw line so an error can quote it back', () => {
      expect(parseRows('  لغتي\t6  ')[0].raw).toBe('لغتي\t6');
    });
  });

  describe('parseCount', () => {
    it('reads a plain number', () => {
      expect(parseCount('6')).toBe(6);
      expect(parseCount(' 12 ')).toBe(12);
      expect(parseCount('0')).toBe(0);
    });

    it('reads a number with a unit next to it', () => {
      expect(parseCount('6 حصص')).toBe(6);
    });

    it('reads Arabic-Indic digits, which is what an Arabic Excel writes', () => {
      expect(parseCount('٦')).toBe(6);
      expect(parseCount('١٢')).toBe(12);
    });

    it('returns null for a cell with no digits', () => {
      // Stripping non-digits and calling Number() gives 0 here, and 0 means
      // "unplanned" — so the subject would drop out of the timetable silently
      // instead of raising an error.
      expect(parseCount('كتير')).toBeNull();
      expect(parseCount('')).toBeNull();
      expect(parseCount('—')).toBeNull();
      expect(parseCount(undefined)).toBeNull();
    });
  });
});