export const transformProjectResponse = (projectDoc: any) => {
    const projectObj = projectDoc.toObject({ virtuals: false });

    const classIds = projectObj.classIds?.map((classItem: any) => classItem._id) ?? [];

    const baseResponse = {
        ...projectObj,
        classes: projectObj.classIds,
        classIds: classIds,
        gradesCriteria: projectObj.gradesCriteriaId,
        gradesCriteriaId: projectObj.gradesCriteriaId?._id ?? null,
        subject: projectObj.subjectId,
        subjectId: projectObj.subjectId?._id ?? null,
        createdAt: undefined,
        updatedAt: undefined
    };

    return baseResponse;
};
