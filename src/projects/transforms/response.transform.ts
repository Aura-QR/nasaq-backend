export const transformProjectResponse = (projectDoc: any) => {
    if (!projectDoc) return null;
    const projectObj = typeof projectDoc.toObject === 'function' ? projectDoc.toObject({ virtuals: false }) : projectDoc;

    const classIds = projectObj.classIds?.map((classItem: any) => classItem._id ?? classItem) ?? [];

    const baseResponse = {
        ...projectObj,
        classes: projectObj.classIds,
        classIds: classIds,
        gradesCriteria: projectObj.gradesCriteriaId,
        gradesCriteriaId: projectObj.gradesCriteriaId?._id ?? projectObj.gradesCriteriaId ?? null,
        subjectOffering: projectObj.subjectOfferingId,
        subjectOfferingId: projectObj.subjectOfferingId?._id ?? projectObj.subjectOfferingId ?? null,
        createdAt: undefined,
        updatedAt: undefined
    };

    return baseResponse;
};
