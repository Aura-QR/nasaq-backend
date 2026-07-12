export const transformStudentResponse = (studentDoc: any) => {
    const studentObj = studentDoc.toObject({ virtuals: false });
    return {
        ...studentObj,
        class: studentObj.classId,
        classId: studentObj.classId?._id ?? null,
    };
};
