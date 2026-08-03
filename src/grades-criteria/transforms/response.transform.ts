export const transformGradesCriteriaResponse = (gradesCriteriaDoc: any) => {
    if (!gradesCriteriaDoc) return null;
    const gradesCriteriaObj = typeof gradesCriteriaDoc.toObject === 'function'
        ? gradesCriteriaDoc.toObject({ virtuals: false })
        : gradesCriteriaDoc;
    return {
        ...gradesCriteriaObj,
        subjectOffering: gradesCriteriaObj.subjectOfferingId,
        subjectOfferingId: gradesCriteriaObj.subjectOfferingId?._id ?? gradesCriteriaObj.subjectOfferingId ?? null,
    };
};
