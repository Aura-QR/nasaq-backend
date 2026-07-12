export const transformLibraryResponse = (libraryDoc: any) => {
  const libraryObj = libraryDoc.toObject({ virtuals: false });
  return {
    ...libraryObj,
    subject: libraryObj.subjectId,
    subjectId: libraryObj.subjectId?._id??null,
  };
};
