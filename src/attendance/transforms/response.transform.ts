export const transformAttendanceResponse = (attendanceDoc: any) => {
    const attendanceObj = attendanceDoc.toObject({ virtuals: false });
    return {
        ...attendanceObj,
        class: attendanceObj.classId,
        classId: attendanceObj.classId?._id ?? null,
        student: attendanceObj.studentId,
        studentId: attendanceObj.studentId?._id ?? null,
        createdAt : undefined,
        updatedAt : undefined
    };
};
