export const transformGradesCriteriaResponse = (gradesCriteriaDoc: any) => {
    const gradesCriteriaObj = gradesCriteriaDoc.toObject({ virtuals: false });
    return {
        ...gradesCriteriaObj,
        subject: gradesCriteriaObj.subjectId,
        subjectId: gradesCriteriaObj.subjectId?._id ?? null,
    };
};
