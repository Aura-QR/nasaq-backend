export const transformLibraryResponse = (libraryDoc: any) => {
  if (!libraryDoc) return null;
  const libraryObj = typeof libraryDoc.toObject === 'function' ? libraryDoc.toObject({ virtuals: false }) : libraryDoc;
  return {
    ...libraryObj,
    subjectOffering: libraryObj.subjectOfferingId,
    subjectOfferingId: libraryObj.subjectOfferingId?._id ?? libraryObj.subjectOfferingId ?? null,
  };
};
