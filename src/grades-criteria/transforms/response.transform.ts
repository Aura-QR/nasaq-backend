export const transformGradesCriteriaResponse = (gradesCriteriaDoc: any) => {
  if (!gradesCriteriaDoc) return null;
  const gradesCriteriaObj =
    typeof gradesCriteriaDoc.toObject === 'function'
      ? gradesCriteriaDoc.toObject({ virtuals: false })
      : gradesCriteriaDoc;

  const offering = gradesCriteriaObj.subjectOfferingId;
  const subjectObj = offering?.subjectId;
  const termObj = offering?.termId;

  const subjectId = subjectObj?._id ?? (typeof subjectObj === 'object' ? null : subjectObj) ?? null;
  const academicYearId = termObj?.academicYearId?._id ?? termObj?.academicYearId ?? null;

  return {
    ...gradesCriteriaObj,
    subjectId,
    academicYearId,
    subjectOffering: gradesCriteriaObj.subjectOfferingId,
    subjectOfferingId: offering?._id ?? offering ?? null,
  };
};
