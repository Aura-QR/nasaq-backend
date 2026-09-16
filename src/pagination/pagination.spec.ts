import { getPagination, MAX_PAGE_SIZE } from './common/paginationUtils';

/**
 * How big a page may be.
 *
 * The ceiling was 100 while every client asked for 200, 500 or 1000 and drew
 * the answer as a complete list. Nothing failed — the extra rows were simply
 * not there. These pin the ceiling that the clients were already written
 * against, and that a request still cannot ask for everything.
 */
describe('getPagination', () => {
  it('gives a caller the page size it asked for, up to the ceiling', () => {
    expect(getPagination(1, 500, 5000).limit).toBe(500);
    expect(getPagination(1, 1000, 5000).limit).toBe(1000);
  });

  it('still refuses to hand over an unbounded collection', () => {
    expect(getPagination(1, 100000, 500000).limit).toBe(MAX_PAGE_SIZE);
  });

  it('a page big enough for everything is one page', () => {
    const page = getPagination(1, 500, 420);

    expect(page.totalPages).toBe(1);
    expect(page.hasNextPage).toBe(false);
  });

  it('skips by the size actually granted, not the size requested', () => {
    // Asking for 100000 and being given 1000, page 3 starts at 2000 — not at
    // 200000, which would page past the end of every collection.
    expect(getPagination(3, 100000, 50000).skip).toBe(2 * MAX_PAGE_SIZE);
  });

  it('falls back to ten when no size is given', () => {
    expect(getPagination(1, undefined as any, 50).limit).toBe(10);
    expect(getPagination(1, 0, 50).limit).toBe(10);
  });

  it('a page number below one is the first page', () => {
    expect(getPagination(0, 10, 50).page).toBe(1);
    expect(getPagination(-5, 10, 50).page).toBe(1);
  });

  it('reports the neighbours of the page it is on', () => {
    const middle = getPagination(2, 10, 50);

    expect(middle.totalPages).toBe(5);
    expect(middle.hasPreviousPage).toBe(true);
    expect(middle.nextPage).toBe(3);
    expect(middle.previousPage).toBe(1);
  });

  it('an empty collection has no pages and no next', () => {
    const empty = getPagination(1, 10, 0);

    expect(empty.totalPages).toBe(0);
    expect(empty.hasNextPage).toBe(false);
    expect(empty.nextPage).toBe(0);
  });
});
