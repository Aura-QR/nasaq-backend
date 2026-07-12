export const transformLectureResponse = (lectureDoc: any) => {
  const lectureObj = lectureDoc.toObject({ virtuals: false });
  return {
    ...lectureObj,
    class: lectureObj.classId,
    classId: lectureObj.classId?._id ?? null,
    teacher: lectureObj.teacherId,
    teacherId: lectureObj.teacherId?._id ?? null,
    subject: lectureObj.subjectId,
    subjectId:lectureObj.subjectId?._id ?? null,
  };
};
