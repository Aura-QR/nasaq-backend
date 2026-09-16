/**
 * The ceiling on one page.
 *
 * It was 100, and every client in the estate had quietly decided `limit`
 * meant "all of it": 66 call sites across the web app and the phone ask for
 * 200, 500 or 1000 and render the answer as a complete list. They were each
 * handed 100 rows with no error and no sign of the ones left behind — a
 * teacher's preparations stopped at the hundredth by mid-year, and a school
 * with more than a hundred subject offerings could not find its own grading
 * criteria.
 *
 * Raising it to cover what the clients actually ask for fixes all of them at
 * once. A ceiling still stands, so a request cannot ask for an unbounded
 * collection; anything genuinely larger has to page, which is now a real
 * decision rather than an accident.
 */
export const MAX_PAGE_SIZE = 1000;

export const DEFAULT_PAGE_SIZE = 10;

export const getPagination = (page: number, limit: number, total: number) => {
  const validPage = Math.max(Number(page) || 1, 1);
  const validLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const skip = (validPage - 1) * validLimit;
  const totalPages = Math.ceil(total / validLimit);
  const hasNextPage = validPage < totalPages;
  const hasPreviousPage = validPage > 1;
  const nextPage = validPage < totalPages ? validPage + 1 : 0;
  const previousPage = validPage > 1 ? validPage - 1 : 0;

  return {
    page: validPage,
    limit: validLimit,
    total,
    skip,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    nextPage,
    previousPage,
  };
};
