import {
  completionGaps,
  completionGapMessages,
  isPreparationComplete,
} from './preparation-completion';
import { REQUIRED_RESOURCE_MESSAGE } from './constants/preparation-constants';

/**
 * Telling a teacher why her preparation is not finished.
 *
 * A supervisor reported teachers insisting they had prepared a week that the
 * schedule kept showing as needing preparation. They had — a row existed, it
 * opened, it was listed under «تحضيراتي». It was also empty: no lesson picked
 * from the curriculum, no objectives, no digital content, no resources.
 *
 * Saving a preparation and finishing one are two different things, and only
 * submit() ever said so. Everywhere else the teacher saw a saved row on one
 * screen and a red mark on another, with nothing anywhere naming the
 * difference — which reads as a broken system, not an unfinished form.
 *
 * This is the state that was found in production: preparation
 * 6ab7b0990e72bf750f690261, saved, weekOf 2026-09-26, entirely empty.
 */
describe('completion gaps — what the teacher still has to do', () => {
  const empty = {
    lessonId: null,
    objectives: [],
    digitalContentIds: [],
  };

  const finished = {
    lessonId: 'lesson-1',
    objectives: ['أن يتعرف الطالب على الكسور'],
    digitalContentIds: ['content-1'],
  };

  describe('the row that was found in production', () => {
    it('is not complete', () => {
      expect(isPreparationComplete(empty, 0)).toBe(false);
    });

    it('names every one of the four requirements', () => {
      // The teacher had done none of them, so she should be told all four
      // rather than made to discover them one save at a time.
      expect(completionGaps(empty, 0)).toEqual([
        'resources',
        'objectives',
        'digitalContent',
        'lesson',
      ]);
    });

    it('names them in Arabic, not as internal keys', () => {
      const messages = completionGapMessages(empty, 0);

      expect(messages).toEqual([
        REQUIRED_RESOURCE_MESSAGE,
        'يجب إضافة هدف واحد على الأقل',
        'يجب إضافة محتوى رقمي واحد على الأقل',
        'يجب اختيار درس من المنهج',
      ]);
      expect(messages.every((m) => typeof m === 'string' && m.length > 0)).toBe(
        true,
      );
    });
  });

  describe('one requirement at a time', () => {
    it('reports only the missing lesson when the rest is done', () => {
      // The likeliest single gap: the form saves without a lesson picked.
      expect(
        completionGapMessages({ ...finished, lessonId: null }, 1),
      ).toEqual(['يجب اختيار درس من المنهج']);
    });

    it('reports only the missing resource when the rest is done', () => {
      expect(completionGapMessages(finished, 0)).toEqual([
        REQUIRED_RESOURCE_MESSAGE,
      ]);
    });

    it('reports only the missing objectives', () => {
      expect(
        completionGapMessages({ ...finished, objectives: [] }, 1),
      ).toEqual(['يجب إضافة هدف واحد على الأقل']);
    });

    it('reports only the missing digital content', () => {
      expect(
        completionGapMessages({ ...finished, digitalContentIds: [] }, 1),
      ).toEqual(['يجب إضافة محتوى رقمي واحد على الأقل']);
    });
  });

  describe('a finished preparation', () => {
    it('is complete', () => {
      expect(isPreparationComplete(finished, 1)).toBe(true);
    });

    it('has nothing to report, so no screen shows a warning', () => {
      // An empty list is what lets the page stay quiet; a stray message on a
      // finished row trains the teacher to ignore all of them.
      expect(completionGapMessages(finished, 1)).toEqual([]);
    });
  });

  describe('things that look done but are not', () => {
    it('does not accept objectives that are only whitespace', () => {
      const blank = { ...finished, objectives: ['   ', ''] };

      expect(isPreparationComplete(blank, 1)).toBe(false);
      expect(completionGapMessages(blank, 1)).toEqual([
        'يجب إضافة هدف واحد على الأقل',
      ]);
    });

    it('does not accept a preparation with no fields at all', () => {
      // A row read back before its fields were populated must not pass.
      expect(isPreparationComplete({}, 0)).toBe(false);
      expect(completionGapMessages({}, 0)).toHaveLength(4);
    });
  });
});
