export const transformStudentResponse = (
    studentDoc: any,
    isUnplaced?: boolean,
) => {
    const studentObj = studentDoc.toObject({ virtuals: false });
    return {
        ...studentObj,
        class: studentObj.classId,
        classId: studentObj.classId?._id ?? null,
        ...(isUnplaced !== undefined ? { isUnplaced } : {}),
    };
};
