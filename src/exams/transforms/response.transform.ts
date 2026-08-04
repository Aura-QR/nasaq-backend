export const transformExamResponse = (ExamDoc: any) => {
    if (!ExamDoc) return null;
    const ExamObj = typeof ExamDoc.toObject === 'function' ? ExamDoc.toObject({ virtuals: false }) : ExamDoc;

    const classIds = ExamObj.classIds?.map((classItem: any) => classItem._id ?? classItem) ?? [];

    const baseResponse = {
        ...ExamObj,

        classes: ExamObj.classIds,
        classIds: classIds,
        gradesCriteria: ExamObj.gradesCriteriaId,
        gradesCriteriaId: ExamObj.gradesCriteriaId?._id ?? ExamObj.gradesCriteriaId ?? null,
        subjectOffering: ExamObj.subjectOfferingId,
        subjectOfferingId: ExamObj.subjectOfferingId?._id ?? ExamObj.subjectOfferingId ?? null,
        createdAt: undefined,
        updatedAt: undefined
    };

    return baseResponse;
};
