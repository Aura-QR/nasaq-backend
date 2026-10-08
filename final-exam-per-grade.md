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

## Update: exam and grade safeguards (second backend change, same day)

**There is nothing new to build.** These are new refusals from the server.
Show each message as it comes, the way other errors are shown.

| Where | Status | Message |
|---|---|---|
| Creating a quiz, assignment or activity when the class already has as many as «معايير الدرجات» allows | 400 | «اكتمل عدد الاختبارات القصيرة المحدد لهذه المادة (3) في أحد الفصول المختارة». Same for الواجبات and اختبارات الأنشطة (one per class) |
| Creating a project in the same situation | 400 | «اكتمل عدد المشاريع المحدد لهذه المادة (1) في أحد الفصول المختارة» |
| Creating a project before the school has set «معايير الدرجات» (it used to invent a distribution) | 400 | «لا يوجد توزيع درجات لهذه المادة. يجب على إدارة المدرسة تحديد توزيع الدرجات قبل إنشاء المشاريع.» |
| Adding, editing or deleting questions (including `PATCH /exams/:id` with `questions`) after any student has started the exam | 400 | «لا يمكن تعديل الأسئلة بعد أن بدأ الطلاب الامتحان». Duration and dates can still change |
| Admin deletes «معايير الدرجات» that has exams or projects (it used to delete all of them and every mark, silently) | 400 | «لا يمكن حذف توزيع الدرجات لارتباطه بـ N اختبار وM مشروع؛ احذفها أولًا» |
| Admin changes the weight or count of a type that already has exams or projects | 400 | «لا يمكن تعديل درجة أو عدد الاختبارات القصيرة بعد إنشاء الاختبارات القصيرة لهذه المادة؛ احذفها أولًا ثم عدّل التوزيع». Passing grade, and types with nothing yet, can still change |
| A student opens an exam not set for her class; any non-student opens an exam | 403 | «هذا الامتحان غير مخصص لفصلك» / «أداء الامتحانات متاح للطلاب فقط» |

| Teacher or admin deletes an exam any student has started | 400 | «لا يمكن حذف امتحان بدأه الطلاب؛ درجاتهم محفوظة عليه» |
| Teacher or admin deletes a project any student has handed in | 400 | «لا يمكن حذف مشروع سلّمه الطلاب؛ تسليماتهم ودرجاتهم محفوظة عليه» |
| A student uploads to, or deletes files from, a project not set for her class; any non-student does | 403 | «هذا المشروع غير مخصص لفصلك» / «تسليم المشاريع متاح للطلاب فقط» |
| A student changes her submission after it is marked, or deletes a file after the due date | 400 | «قُيّم هذا التسليم؛ لا يمكن تعديله» / «انتهى الوقت المحدد لتسليم هذا المشروع» |
| A teacher marks a project for a student outside her own sections | 403 | «ليس لديك صلاحية لتقييم هذا الطالب في هذه المادة» |

**Now closed to students:** `GET /exams/:examId/results`,
`GET /projects/:projectId/submissions` and
`.../submissions/:studentId/download`. These are other students' marks and
work. Students keep `my-result` and `my-submission`. No student screen calls
the closed routes.

**Hide the delete button** on an exam with `startedCount > 0`, and on a
project with submissions. The student app should hide «تعديل التسليم» once the
submission has a mark.

**Behaviour changes**
- **Two minutes' grace on submission.** The automatic submit when the
  timer hits zero is no longer refused for arriving a moment late. **Keep
  the auto-submit at zero.**
- **Each question is counted once,** whatever the client sends.
  `answeredQuestions` in the response now counts distinct questions.
- **A paper is accepted once,** even if two submissions race each other.

**Optional UI improvements**
- **Teacher's exam editor:** if the exam already has results
  (`GET /exams/:id/results`, `startedCount > 0`), make the questions
  read-only and show «بدأ الطلاب الامتحان؛ لا يمكن تعديل الأسئلة».
- **Teacher's create form:** after she picks the subject and type, show how
  many are left. For example, «المتبقي: 1 من 3» from her exam list.

## What does not change

- How students take an exam, and how it is marked.
- The grade distribution screen («معايير الدرجات»).
- The student's grades screen. It now shows correct numbers, with the same
  response shape.
