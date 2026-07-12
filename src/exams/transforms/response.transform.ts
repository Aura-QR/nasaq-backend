export const transformExamResponse = (ExamDoc: any) => {
    const ExamObj = ExamDoc.toObject({ virtuals: false });

    const classIds = ExamObj.classIds?.map((classItem: any) => classItem._id) ?? [];

    const baseResponse = {
        ...ExamObj,

        classes: ExamObj.classIds,
        classIds: classIds,
        gradesCriteria: ExamObj.gradesCriteriaId,
        gradesCriteriaId: ExamObj.gradesCriteriaId?._id ?? null,
        createdAt: undefined,
        updatedAt: undefined
    };

    return baseResponse;
};
