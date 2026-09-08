import {
  parseCsv,
  readMapping,
  readRecovered,
  splitLessonName,
  convert,
} from './convert-madrasati-catalog';

describe('Madrasati → catalogue conversion', () => {
  describe('parseCsv', () => {
    it('keeps a comma that lives inside a quoted field', () => {
      // Row 136 of the real sheet. A split(',') here shifted every later
      // column and gave one course the subject name "72".
      const csv =
        'subjectId,label,units,lessons,subject\n' +
        '3752,"IT’S A GOOD DEAL , ISN’T IT?",12,72,اللغة الإنجليزية\n';
      const rows = parseCsv(csv);
      expect(rows[1]).toEqual([
        '3752',
        'IT’S A GOOD DEAL , ISN’T IT?',
        '12',
        '72',
        'اللغة الإنجليزية',
      ]);
    });

    it('reads a doubled quote as one quote', () => {
      expect(parseCsv('a,"say ""hi""",b')[0]).toEqual(['a', 'say "hi"', 'b']);
    });

    it('strips the BOM the sheet was exported with', () => {
      expect(parseCsv('﻿subjectId,name\n1,x')[0][0]).toBe('subjectId');
    });

    it('handles CRLF', () => {
      expect(parseCsv('a,b\r\nc,d')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });
  });

  describe('readMapping', () => {
    const csv =
      'subjectId,الاسم في الملف (خطأ),وحدات,دروس,المادة (مقترحة),ثقة,الصف — املأه,عينة\n' +
      '86,القيم الإسلامية,10,88,اللغة العربية,90,الصف السادس,x\n' +
      '90,الجبر و الدوال,9,85,الرياضيات,88,,y\n';

    it('reads the subject, variant and grade by heading', () => {
      const map = readMapping(csv);
      expect(map.get('86')).toEqual({
        subject: 'اللغة العربية',
        variant: 'القيم الإسلامية',
        grade: 'الصف السادس',
      });
      expect(map.get('90')?.grade).toBe('');
    });

    it('finds the columns by name, not by position', () => {
      // A column inserted at the front must not shift the subject into the
      // confidence score.
      const shifted =
        'ملاحظات,subjectId,الاسم في الملف,المادة (مقترحة),الصف — املأه\n' +
        'x,86,القيم الإسلامية,اللغة العربية,الصف السادس\n';
      // subjectId is read positionally at 0 by design, so this row's id is
      // "x" and is skipped rather than mis-mapped.
      expect(readMapping(shifted).size).toBe(0);
    });

    it('refuses a sheet with no subject column rather than seeding blanks', () => {
      expect(() => readMapping('subjectId,units\n86,10\n')).toThrow('المادة');
    });
  });

  describe('splitLessonName', () => {
    it('splits unit from lesson', () => {
      expect(
        splitLessonName('القيم الإسلامية -- نص الانطلاق (قبس من القرآن الكريم)'),
      ).toEqual({
        unit: 'القيم الإسلامية',
        lesson: 'نص الانطلاق (قبس من القرآن الكريم)',
      });
    });

    it('splits once, so a lesson may contain the separator itself', () => {
      expect(splitLessonName('الوحدة -- الدرس -- الجزء الثاني')).toEqual({
        unit: 'الوحدة',
        lesson: 'الدرس -- الجزء الثاني',
      });
    });

    it('treats a name with no separator as its own unit', () => {
      expect(splitLessonName('درس مفرد')).toEqual({
        unit: 'درس مفرد',
        lesson: 'درس مفرد',
      });
    });
  });

  describe('readRecovered', () => {
    const file = {
      subjects: [
        { subjectId: '86', subjectName: 'اللغة العربية', gradeName: 'الصف الأول المتوسط', status: 'matched-local-lesson-ids' },
        { subjectId: '208', subjectName: '', gradeName: '', status: 'needs-review' },
        { subjectId: '90', subjectName: 'الرياضيات', gradeName: 'needs-review', status: 'matched-local-lesson-ids' },
      ],
    };

    it('reads a settled row', () => {
      expect(readRecovered(file).get('86')).toEqual({
        subject: 'اللغة العربية',
        grade: 'الصف الأول المتوسط',
      });
    });

    it('drops a needs-review row instead of merging its empty subject', () => {
      // Letting it through would blank a name the CSV had right.
      expect(readRecovered(file).has('208')).toBe(false);
    });

    it("treats 'needs-review' in the grade as no grade, not as a grade name", () => {
      expect(readRecovered(file).get('90')).toEqual({
        subject: 'الرياضيات',
        grade: '',
      });
    });

    it('accepts a bare array as well as the wrapped file', () => {
      expect(readRecovered(file.subjects).size).toBe(2);
    });

    it('is empty for junk rather than throwing', () => {
      expect(readRecovered(null).size).toBe(0);
      expect(readRecovered({}).size).toBe(0);
    });
  });

  describe('convert', () => {
    const mapping = new Map([
      ['86', { subject: 'اللغة العربية', variant: 'القيم الإسلامية', grade: '' }],
    ]);
    const course = (over: any = {}) => ({
      subjectId: 86,
      rawLessonsList: [
        { id: '86,87,273', name: 'القيم الإسلامية -- مدخل الوحدة' },
        { id: '86,87,38499', name: 'القيم الإسلامية -- نص الانطلاق' },
        { id: '86,90,401', name: 'الوحدة الثانية -- درس أول' },
      ],
      ...over,
    });

    it('produces the shape the seed expects', () => {
      const { subjects } = convert([course()], mapping);
      expect(subjects).toHaveLength(1);
      expect(subjects[0]).toMatchObject({
        subjectId: '86',
        subjectName: 'اللغة العربية',
        subjectVariant: 'القيم الإسلامية',
      });
      expect(subjects[0].lessons[0]).toEqual({
        id: '86,87,273',
        unit: 'القيم الإسلامية',
        lessonName: 'مدخل الوحدة',
      });
    });

    it('names the subject from the mapping, not from the first unit', () => {
      // The whole point: the source's own label is a unit name, and 44 of
      // them repeat across different courses.
      const { subjects } = convert([course()], mapping);
      expect(subjects[0].subjectName).toBe('اللغة العربية');
      expect(subjects[0].subjectName).not.toBe('القيم الإسلامية');
    });

    it('drops a lesson whose id belongs to another subject', () => {
      // The seed rejects the whole batch for one of these, so it is caught
      // here where it can be reported instead.
      const bad = course({
        rawLessonsList: [
          { id: '86,87,273', name: 'وحدة -- درس' },
          { id: '99,87,999', name: 'وحدة -- درس دخيل' },
        ],
      });
      const { subjects } = convert([bad], mapping);
      expect(subjects[0].lessons.map((l) => l.id)).toEqual(['86,87,273']);
    });

    it('drops a repeated lesson id', () => {
      const dup = course({
        rawLessonsList: [
          { id: '86,87,273', name: 'وحدة -- درس' },
          { id: '86,87,273', name: 'وحدة -- نفس الدرس' },
        ],
      });
      expect(convert([dup], mapping).subjects[0].lessons).toHaveLength(1);
    });

    it('skips, and reports, a course the sheet has no subject for', () => {
      const { subjects, skipped } = convert([course({ subjectId: 999 })], mapping);
      expect(subjects).toHaveLength(0);
      expect(skipped[0]).toContain('999');
    });

    it('skips a course with no usable lessons', () => {
      const { subjects, skipped } = convert(
        [course({ rawLessonsList: [] })],
        mapping,
      );
      expect(subjects).toHaveLength(0);
      expect(skipped[0]).toContain('no usable lessons');
    });

    describe('with the recovered mapping', () => {
      const recovered = new Map([
        ['86', { subject: 'اللغة العربية', grade: 'الصف الأول المتوسط' }],
      ]);

      it('prefers the recovered subject over the sheet', () => {
        // The sheet was hand-assigned from the first unit's name and is wrong
        // for 90 of the 162 courses.
        const wrongSheet = new Map([
          ['86', { subject: 'التربية الصحية والبدنية', variant: 'القيم الإسلامية', grade: '' }],
        ]);
        const { subjects } = convert([course()], wrongSheet, recovered);
        expect(subjects[0].subjectName).toBe('اللغة العربية');
      });

      it('carries the recovered grade, which is what separates two look-alike courses', () => {
        const { subjects } = convert([course()], mapping, recovered);
        expect(subjects[0].gradeName).toBe('الصف الأول المتوسط');
      });

      it('keeps the sheet variant — the recovery has no equivalent', () => {
        const { subjects } = convert([course()], mapping, recovered);
        expect(subjects[0].subjectVariant).toBe('القيم الإسلامية');
      });

      it('falls back to the sheet for a course the recovery did not settle', () => {
        const { subjects } = convert([course()], mapping, new Map());
        expect(subjects[0].subjectName).toBe('اللغة العربية');
      });

      it('takes a course the sheet has no subject for when the recovery does', () => {
        const { subjects } = convert([course()], new Map(), recovered);
        expect(subjects[0].subjectName).toBe('اللغة العربية');
        // No sheet row, so the variant comes from the first unit.
        expect(subjects[0].subjectVariant).toBe('القيم الإسلامية');
      });
    });

    it('falls back to the first unit when the sheet has no variant', () => {
      const noVariant = new Map([
        ['86', { subject: 'اللغة العربية', variant: '', grade: '' }],
      ]);
      expect(convert([course()], noVariant).subjects[0].subjectVariant).toBe(
        'القيم الإسلامية',
      );
    });
  });
});
