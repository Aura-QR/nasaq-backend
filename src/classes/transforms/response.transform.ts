import { Virtual } from "@nestjs/mongoose";

export const transformClassResponse = (classDoc: any) => {
    const classObj = classDoc.toObject({ virtuals: false });
    return {
        ...classObj,
        subjects: classObj.subjectIds,
        subjectIds: undefined,
        students: classObj.studentIds,
        studentIds: undefined,
        teacherInCharge : classObj.teacherInChargeId,
        teacherInChargeId :classObj.teacherInChargeId?._id ?? null
    };
}