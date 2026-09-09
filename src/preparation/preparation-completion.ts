import { REQUIRED_RESOURCE_MESSAGE } from './constants/preparation-constants';

/**
 * What makes a preparation finished — in one place.
 *
 * `submit()` has always enforced exactly these four things. The trouble was
 * that nothing else could see them: the list endpoint returned rows without
 * `resources`, `objectives` or `digitalContentIds`, so the teacher's two
 * screens each grew their own copy of the rule and then fetched every
 * preparation individually to feed it. Three copies of one rule, and up to
 * five hundred requests to recompute an answer the server already knew.
 *
 * So the rule lives here, the API reports it as `isComplete`, and the pages
 * read it instead of guessing.
 *
 * The order matters: `submit()` reports the first gap it finds, and these
 * messages are what the teacher reads.
 */
export const COMPLETION_GAP_MESSAGES: Record<string, string> = {
  resources: REQUIRED_RESOURCE_MESSAGE,
  objectives: 'يجب إضافة هدف واحد على الأقل',
  digitalContent: 'يجب إضافة محتوى رقمي واحد على الأقل',
  lesson: 'يجب اختيار درس من المنهج',
};

/** Trimmed, non-empty objectives. An array of blanks is not an objective. */
export const usableObjectives = (preparation: any): string[] =>
  (Array.isArray(preparation?.objectives) ? preparation.objectives : [])
    .map((value: any) => String(value ?? '').trim())
    .filter(Boolean);

/**
 * Which requirements this preparation does not meet yet, in the order
 * `submit()` reports them. Empty means it is ready to send.
 */
export function completionGaps(preparation: any, resourceCount: number): string[] {
  const gaps: string[] = [];
  if (!resourceCount) gaps.push('resources');
  if (!usableObjectives(preparation).length) gaps.push('objectives');
  if (!preparation?.digitalContentIds?.length) gaps.push('digitalContent');
  if (!preparation?.lessonId) gaps.push('lesson');
  return gaps;
}

export const isPreparationComplete = (preparation: any, resourceCount: number): boolean =>
  completionGaps(preparation, resourceCount).length === 0;
