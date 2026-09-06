import { parseCatalog } from '../scripts/seed-catalog';

describe('catalog source parsing', () => {
  it('preserves full source IDs, flattens deeper lessons under their original unit and removes duplicates', () => {
    const parsed = parseCatalog([
      {
        subjectId: 95,
        subjectName: ' العلوم ',
        lessons: [
          { id: '95,96,97,307', unit: 'الوحدة', lessonName: 'الفصل -- الدرس' },
          { id: '95,96,98', unit: 'الوحدة', lessonName: 'آخر' },
          { id: '95,96,97,307', unit: 'الوحدة', lessonName: 'الفصل -- الدرس' },
        ],
      },
    ]);
    expect(parsed.counts).toEqual({ subjects: 1, units: 1, lessons: 2 });
    expect(parsed.subjects[0].lessons[0].id).toBe('95,96,97,307');
    expect(parsed.subjects[0].subjectName).toBe('العلوم');
  });

  it.each([
    {},
    [
      {
        subjectId: 95,
        subjectName: 'العلوم',
        lessons: [{ id: '96,1,2', unit: 'وحدة', lessonName: 'درس' }],
      },
    ],
    [
      {
        subjectId: 95,
        subjectName: 'العلوم',
        lessons: [{ id: '95,1,2', unit: 'وحدة', lessonName: ' ' }],
      },
    ],
  ])('rejects malformed or mismatched source data before writing', (input) => {
    expect(() => parseCatalog(input)).toThrow();
  });
});
