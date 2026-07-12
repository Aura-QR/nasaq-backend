export const getPagination = (page: number, limit: number, total: number) => {
  const validPage = Math.max(Number(page) || 1, 1);
  const validLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
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