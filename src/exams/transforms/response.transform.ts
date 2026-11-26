import { effectiveMarks, presentQuestion } from '../question-rules.util';

export const transformExamResponse = (ExamDoc: any) => {
    if (!ExamDoc) return null;
    const ExamObj = typeof ExamDoc.toObject === 'function' ? ExamDoc.toObject({ virtuals: false }) : ExamDoc;

    const classIds = ExamObj.classIds?.map((classItem: any) => classItem._id ?? classItem) ?? [];

    // Every question reads with a type and a numeric `marks` — an old exam's
    // equal share — so no client has to handle a missing one.
    const marks = Array.isArray(ExamObj.questions) ? effectiveMarks(ExamObj) : [];
    const questions = Array.isArray(ExamObj.questions)
        ? ExamObj.questions.map((q: any, i: number) => presentQuestion(q, marks[i]))
        : ExamObj.questions;

    const baseResponse = {
        ...ExamObj,

        questions,
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
