import * as fs from 'fs';
import * as path from 'path';

/**
 * Reading مواهب المملكة's timetable out of their PDF.
 *
 * Two things go wrong silently here and both are expensive.
 *
 * The first is the transcription: 382 cells copied by eye out of a PDF. A cell
 * read into the wrong period is a lesson a class turns up to and a teacher
 * does not, and nobody finds out until the morning. aSc lays a week out in a
 * regular shape, so the shape itself is worth asserting.
 *
 * The second is name matching. The PDF writes «التربية الاسلامية» with a bare
 * alif and the system stores «التربية الإسلامية» with a hamza; compared as
 * typed they are different subjects, and the import reports a dozen missing
 * subjects that are sitting right there.
 */

const fold = (value: string) =>
  String(value ?? '')
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^ء-ي0-9a-zA-Z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const firstNameOf = (value: string) => fold(value).split(' ')[0] ?? '';

const plan = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'mwahb-timetable.json'), 'utf8'),
);

describe('matching names the PDF spells differently', () => {
  it('reads past a hamza the school did not type', () => {
    expect(fold('التربية الاسلامية')).toBe(fold('التربية الإسلامية'));
    expect(fold('الدراسات الإجتماعيات')).toBe(fold('الدراسات الاجتماعيات'));
  });

  it('reads past a final ة written as ه', () => {
    // «ناديه» in the PDF, «نادية معيوف الشريف» in the system.
    expect(firstNameOf('ناديه')).toBe(firstNameOf('نادية معيوف الشريف'));
    expect(firstNameOf('جوهرة')).toBe(firstNameOf('جوهره سليمان'));
  });

  it('matches a teacher on her first name, which is all the PDF gives', () => {
    expect(firstNameOf('سمر')).toBe(firstNameOf('سمر سعود محمد المالكي'));
    expect(firstNameOf('عنود القرشي')).toBe(firstNameOf('عنود محمد عيضه القرشي'));
  });

  it('does not collapse two different people', () => {
    // The whole point of reporting ambiguity rather than guessing.
    expect(firstNameOf('أمجاد المنتشري')).not.toBe(firstNameOf('أميرة عبدالله'));
    expect(firstNameOf('بسمة')).not.toBe(firstNameOf('بشاير عايد'));
  });
});

describe('the transcription itself', () => {
  const everyCell = plan.classes.flatMap((entry: any) =>
    plan.days.flatMap((day: string) =>
      (entry.grid[day] ?? []).map((cell: any, index: number) => ({
        cell,
        slot: index + 1,
        day,
        className: entry.systemClass,
      })),
    ),
  );

  const filled = everyCell.filter((row: any) => row.cell);

  it('covers every class in the PDF exactly once', () => {
    const names = plan.classes.map((entry: any) => entry.systemClass);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(11);
  });

  it('gives every class five days of exactly eight cells', () => {
    // aSc prints a fixed 5×8 grid and pads with blanks. A row of a different
    // length means a line was dropped or doubled while transcribing.
    for (const entry of plan.classes) {
      for (const day of plan.days) {
        expect(entry.grid[day]).toHaveLength(8);
      }
    }
  });

  it('never leaves a hole in the middle of a day', () => {
    // A blank period between two lessons is possible in principle and does
    // not happen in this PDF: every day runs from period 1 without a break.
    // A hole here means a cell landed in the wrong column.
    for (const entry of plan.classes) {
      for (const day of plan.days) {
        const cells = entry.grid[day];
        const lastFilled = cells.reduce(
          (last: number, cell: any, index: number) => (cell ? index : last),
          -1,
        );
        for (let index = 0; index <= lastFilled; index += 1) {
          expect(cells[index]).not.toBeNull();
        }
      }
    }
  });

  it('gives each class between 34 and 36 periods', () => {
    // The school's real week, and notably not the 40 the system is configured
    // for — which is why every class read as underfilled.
    for (const entry of plan.classes) {
      const count = plan.days.reduce(
        (sum: number, day: string) =>
          sum + entry.grid[day].filter(Boolean).length,
        0,
      );
      expect(count).toBeGreaterThanOrEqual(34);
      expect(count).toBeLessThanOrEqual(36);
    }
  });

  it('names a subject and a teacher in every filled cell', () => {
    for (const row of filled) {
      expect(Array.isArray(row.cell)).toBe(true);
      expect(String(row.cell[0]).trim().length).toBeGreaterThan(1);
      expect(String(row.cell[1]).trim().length).toBeGreaterThan(1);
    }
  });

  it('never books one class twice in the same period', () => {
    const seen = new Set<string>();
    for (const row of filled) {
      const key = `${row.className}|${row.day}|${row.slot}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('never books one teacher in two classes at once', () => {
    // The unique index would reject the second write anyway, but finding it
    // here means finding it before half a timetable is already in.
    //
    // Cells naming two teachers («نور / جوهرة» on gym) are skipped: the two of
    // them split the classes running in that period, so the same label in two
    // places is the arrangement, not a clash. The importer cannot resolve a
    // pair to one person either, and reports it rather than guessing.
    const seen = new Map<string, string>();

    for (const row of filled) {
      const label = String(row.cell[1]);
      if (label.includes('/')) continue;

      const key = `${fold(label)}|${row.day}|${row.slot}`;
      const clash = seen.get(key);

      if (clash) {
        throw new Error(
          `${label} في ${row.className} و${clash} — ${row.day} حصة ${row.slot}`,
        );
      }
      seen.set(key, row.className);
    }
  });

  it('flags every shared cell so nobody is assigned by guesswork', () => {
    const shared = filled.filter((row: any) => String(row.cell[1]).includes('/'));

    // Gym in ten classes plus one تدريب نافس. If this number moves, a pair was
    // silently collapsed to one name — which is what produced a false clash
    // the first time this file was written.
    expect(shared).toHaveLength(11);
    for (const row of shared) {
      expect(String(row.cell[1]).split('/').length).toBe(2);
    }
  });
});

/**
 * The names the school had to settle by hand.
 *
 * The PDF writes a nickname («نور» for مناير), a first name that two staff
 * share («جوهرة»), and a pair where only one person actually teaches
 * («فاطمة / بسمة»). The school answered each one. These pin the answers so a
 * later edit to the override table cannot quietly reassign someone's lessons
 * to a colleague — a lecture on the wrong teacher's timetable is worse than
 * one with no teacher at all, because nobody goes looking for it.
 */
describe('the labels the school resolved for us', () => {
  const OVERRIDES: Record<string, string> = {
    'نور': 'الشرعبي',
    'نور / جوهرة': 'الشرعبي',
    'جوهرة': 'جوهرة سليمان',
    'فاطمة / بسمة': 'فاطمة سعد',
  };

  const roster = [
    'مناير بندر الشرعبي',
    'جوهرة سليمان سعيد المالكي',
    'جوهرة عبدالله الجعيد',
    'فاطمة سعد عايش الدهاسي',
    'بسمة محمد عبدالفتاح سبعجد',
  ];

  const resolve = (label: string) => {
    const needle = fold(OVERRIDES[label]);
    return roster.filter((name) => fold(name).includes(needle));
  };

  it('sends every gym lesson to مناير', () => {
    expect(resolve('نور')).toEqual(['مناير بندر الشرعبي']);
    expect(resolve('نور / جوهرة')).toEqual(['مناير بندر الشرعبي']);
  });

  it('picks جوهرة سليمان and leaves جوهرة الجعيد in كيجي٢', () => {
    expect(resolve('جوهرة')).toEqual(['جوهرة سليمان سعيد المالكي']);
  });

  it('gives تدريب نافس to فاطمة alone', () => {
    expect(resolve('فاطمة / بسمة')).toEqual(['فاطمة سعد عايش الدهاسي']);
  });

  it('matches مناير on her family name, not on a first name nobody types', () => {
    // Her name is مناير — not منيرة, which is what everyone assumes it must
    // be, this author included. The PDF then calls her «نور» on top of that.
    // The family name is the only part that survives all three.
    expect(fold('مناير بندر الشرعبي')).toContain(fold('الشرعبي'));
    expect(resolve('نور')).toEqual(['مناير بندر الشرعبي']);
  });

  it('covers every label the PDF could not resolve on its own', () => {
    const unresolved = new Set<string>();

    for (const entry of plan.classes) {
      for (const day of plan.days) {
        for (const cell of entry.grid[day]) {
          if (!cell) continue;
          const label = String(cell[1]);
          if (label.includes('/') || label === 'نور' || label === 'جوهرة') {
            unresolved.add(label);
          }
        }
      }
    }

    for (const label of unresolved) {
      expect(Object.keys(OVERRIDES)).toContain(label);
    }
  });
});
