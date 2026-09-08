import {
  applyDataMigration,
  chooseCandidate,
  matchCourse,
  parseValues,
} from './recover-catalog-mapping';
import { CatalogSourceSubject } from './convert-madrasati-catalog';

describe('Recover catalogue metadata from Hader', () => {
  it('reads SQL literals without executing them, including quotes and commas', () => {
    expect(
      parseValues("1, NULL, 'IT''S A GOOD DEAL, ISN''T IT?', 'اسم عربي'"),
    ).toEqual([1, null, "IT'S A GOOD DEAL, ISN'T IT?", 'اسم عربي']);
    expect(() => parseValues('1, now()')).toThrow('Unsupported SQL literal');
  });

  it('applies the track reassignment before using a subject grade', () => {
    const tables = {
      grades: new Map<number, any>(),
      subjects: new Map([[93, { id: 93, grade_id: 10 }]]),
    };
    applyDataMigration(
      tables,
      [
        'INSERT INTO grades (id, stage_id, name, track) VALUES',
        "  (24, 3, 'السنة الثانية', 'المسار الشرعي')",
        'ON CONFLICT (id) DO NOTHING;',
        'UPDATE subjects SET grade_id = 24 WHERE id = 93;',
      ].join('\n'),
    );
    expect(tables.subjects.get(93).grade_id).toBe(24);
    expect(tables.grades.get(24).track).toBe('المسار الشرعي');
  });

  const course: CatalogSourceSubject = {
    subjectId: '95',
    subjectName: 'العلوم',
    subjectVariant: '',
    gradeName: '',
    lessons: [
      {
        id: '95,96,97,307',
        unit: 'العلم',
        lessonName: 'طبيعة العلم -- العلم وعملياته',
      },
    ],
  };
  const row = {
    title: 'العلم وعملياته',
    parentId: 97,
    subjectId: 4,
    subjectName: 'العلوم',
    gradeName: 'الصف الأول المتوسط',
    stageName: 'المرحلة المتوسطة',
    track: null,
  };

  it('matches the chapter immediately before the leaf in a four-part ID', () => {
    const result = matchCourse(course, new Map([['307', [row, row]]]));
    expect(result[0].matchedLessons).toBe(1);
    expect(result[0].parentAndLessonMatches).toBe(1);
  });

  it('rejects an ID collision with a different lesson title', () => {
    expect(
      matchCourse(course, new Map([['307', [{ ...row, title: 'درس آخر' }]]])),
    ).toEqual([]);
  });

  it('keeps a separator inside a leaf title rather than truncating it', () => {
    const threePart = {
      ...course,
      lessons: [
        { id: '86,97,307', unit: 'وحدة', lessonName: 'درس -- الجزء الثاني' },
      ],
    };
    expect(
      matchCourse(
        threePart,
        new Map([['307', [{ ...row, title: 'درس -- الجزء الثاني' }]]]),
      )[0].matchedLessons,
    ).toBe(1);
  });

  it('does not assign a grade when identical content is reused in another stage', () => {
    const candidates = matchCourse(
      course,
      new Map([
        [
          '307',
          [
            row,
            {
              ...row,
              subjectId: 5,
              gradeName: 'الصف الأول',
              stageName: 'تعليم مستمر',
            },
          ],
        ],
      ]),
    );
    expect(chooseCandidate(candidates, 1)).toBeUndefined();
  });

  it('retains multiple tracks with the same subject and grade without ambiguity', () => {
    const candidates = matchCourse(
      course,
      new Map([
        [
          '307',
          [
            { ...row, track: 'مسار أ' },
            { ...row, subjectId: 5, track: 'مسار ب' },
          ],
        ],
      ]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tracks).toHaveLength(2);
    expect(chooseCandidate(candidates, 1)).toBeDefined();
  });

  it('rejects a match supported by too few of the course lessons', () => {
    expect(chooseCandidate([{ matchedLessons: 10 }], 29)).toBeUndefined();
    expect(
      chooseCandidate([{ matchedLessons: 29 }, { matchedLessons: 10 }], 29),
    ).toBeUndefined();
    expect(
      chooseCandidate([{ matchedLessons: 25 }, { matchedLessons: 2 }], 29),
    ).toBeDefined();
  });
});
