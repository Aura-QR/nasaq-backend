# Exams: One Final per Grade, and Grades per Class — Web & Mobile Handoff

For the web (React) and mobile (Flutter) developers. This file covers both.
**The backend is done and deployed** (backend `614746d`). All UI copy stays in
formal Arabic.

## What changed

**1. The final exam belongs to the whole grade.**
- There is **one final per subject, per grade, per term**, and it goes to
  **every class of that grade**, including classes another teacher teaches.
- **Any teacher who teaches the subject in that grade** can create it. After
  that, every teacher of the subject there can see, edit, add questions to,
  or delete it. It is no longer one teacher's alone.
- Quizzes, assignments and activities are unchanged. Each one belongs to
  the teacher who made it, for the classes she picked.

**2. Term grades now count each student's own class only.** Before, with two
teachers of a subject, a student in the second section was scored on the
first section's final, which she never sat, and got 0. This is a backend
fix, so there is nothing to build for it.

**3. Removed:** `DELETE /exams/deleteAll` and `DELETE /projects/deleteAll`.
No client used them.

## What to build

### Create exam form (web `TeacherExamAdd`, mobile `teacher_add_edit_exam_screen`)

When the type is **final** («اختبار نهائي»):
- **Hide the class picker.** Show this note in its place:
  «يُطبَّق الاختبار النهائي على جميع فصول الصف في هذه المادة».
- **Still send `classIds`.** The field is required, so send the teacher's
  own classes for that subject (any one of them is enough). The server
  replaces the list with every class of the grade.
- The response's `classIds` holds every class of the grade. Show those.

**A second final for the same subject and grade is refused** with 400:
> «يوجد امتحان نهائي لهذه المادة في هذا الصف لهذا الفصل الدراسي، ويمكن لمعلمات المادة تعديله»

Show the message as is. Better: before submitting, check the teacher's exam
list (below) for an existing final of that subject. If one exists, show
«يوجد اختبار نهائي لهذه المادة» with a button to open it, instead of
letting her fill the form.

### Teacher's exam list (`GET /exams` as a teacher)

- It now returns her own exams **plus the final of every subject she
  teaches**, even when another teacher created it.
- `createdBy` (name, email) is already on each exam. When it is not the
  current teacher, show «أعدّته: {name}» on the card.
- **Edit and delete stay enabled for that final.**

### Editing an exam (`PATCH /exams/:id`)

- On a final, `classIds` and `subjectOfferingId` are **ignored**. Hide the
  class picker when editing a final, as on create.
- Changing the type **to or from** final is refused with 400:
  «لا يمكن تغيير نوع الامتحان من نهائي أو إليه؛ احذفه وأنشئ امتحانًا جديدًا».
  On edit, either lock the type select for a final, or remove «نهائي» from
  it for other types.

### Errors that can now appear

| Where | Status | Message |
|---|---|---|
| Edit, delete, add, edit or delete a question on another teacher's quiz or assignment | 403 | «يمكنك تعديل الامتحانات التي أعددتها فقط» |
| Create a final for a subject she does not teach in that grade | 403 | «يمكن إعداد الامتحان النهائي لمادة تدرّسها في هذا الصف فقط» |
| Correct a student's mark (`PATCH /exams/:examId/students/:studentId/grade`) for a student outside her own sections | 403 | «ليس لديك صلاحية لتعديل درجات هذا الطالب في هذه المادة» |

On the results screen of a shared final, a teacher sees every student of
the grade. Only her own students' marks can be corrected. Either disable the
edit button on the other rows, or show the 403 message.

## What does not change

- How students take an exam, and how it is marked.
- The grade distribution screen («معايير الدرجات»).
- The student's grades screen. It now shows correct numbers, with the same
  response shape.
