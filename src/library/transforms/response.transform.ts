export const transformLibraryResponse = (libraryDoc: any) => {
  if (!libraryDoc) return null;
  const libraryObj = typeof libraryDoc.toObject === 'function' ? libraryDoc.toObject({ virtuals: false }) : libraryDoc;

  const offering = libraryObj.subjectOfferingId;
  const subjectObj = offering?.subjectId;
  const termObj = offering?.termId;

  const subjectId = subjectObj?._id ?? (typeof subjectObj === 'object' ? null : subjectObj) ?? null;
  const academicYearId = termObj?.academicYearId?._id ?? termObj?.academicYearId ?? null;

  return {
    ...libraryObj,
    subjectId,
    academicYearId,
    subjectOffering: libraryObj.subjectOfferingId,
    subjectOfferingId: offering?._id ?? offering ?? null,
  };
};
