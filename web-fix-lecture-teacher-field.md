# Web fix: the teacher field on «إضافة حصة» and «تعديل حصة»

**For:** Arwaa (`nasaq-frontend`).
**Backend:** no change. `POST /lectures` and `PATCH /lectures/:id` already accept a period with no teacher, or with **any** teacher of the school. They refuse only a teacher who is already teaching another class in the same slot (409).
**Files:** `src/pages/School/Lectures/Edit.jsx`, `src/pages/School/Lectures/Add.jsx`.

## The problem

مواهب assigns no teacher to many subjects, such as «وجبة», «لعب بالخارج» and «نشاط»; the timetable they gave us puts a teacher on those periods directly. Two things on the web block them:

1. **On «تعديل حصة» the teacher is required.** The Select has `required` (`Edit.jsx`, around line 1281), so a period «بدون معلم» cannot be saved at all, not even to change its subject or day. The error is also in English («This Field Is Required»). On «إضافة حصة» the same field is optional.
2. **Both pages list only the teachers assigned to the subject** (`fetchTeacherAssignments({ subjectOfferingId })`: `Edit.jsx` around line 832, `Add.jsx` around line 716). For a subject with no assignment the list is empty and the field is disabled (`teacherOptions.length === 0`). The owner could not put هاجر on a «لعب بالخارج» period although the timetable shows her on the same subject on other days.

## The fix

### 1. Teacher optional on edit (`Edit.jsx`)
- Remove `required` from the teacher `<Select>`, and label it «المعلم (اختياري)», as on Add.
- **On save, send `teacherId: null` when the field is empty, never `""`.** The API validates `teacherId` as a Mongo id: `null` is accepted and means «بدون معلم», while `""` is refused with 400. Today the payload is `teacherId: formData.teacherId || selectedTeacherId`, so make it `… || null`.

### 2. No assignment → offer all teachers (both pages)
After loading the assignments for the selected subject:

- **Assignments found:** keep today's behaviour and list only those teachers. Nothing changes where a school assigns teachers.
- **None found:** load all the school's teachers (`fetchTeachers` from `@/APIs/users/teachers`, the same list the teachers page uses), list them, and **keep the field enabled**. Replace the current message with:
  > لا يوجد معلم مسند لهذه المادة، ويمكنك اختيار أي معلم أو حفظ الحصة بدون معلم.
- **On Edit:** always keep the period's current teacher in the list, even if she is neither assigned nor in the list, so opening a period never blanks its teacher. `Edit.jsx` already does this with `teacherValues.unshift(currentTeacher)`; keep it.
- Remove the `teacherOptions.length === 0` condition from `disabled`, or keep the field enabled whenever the fallback list is shown.

### 3. Show the server's message on conflict
If the chosen teacher already has a period in that slot, the API answers 409. Show its message. A friendlier Arabic wording is welcome: «المعلمة لديها حصة أخرى في هذا الوقت».

## Test (on yamamah, or ask the owner before touching مواهب)

1. Open a period whose subject has **no** assigned teacher. The teacher list shows all teachers and the hint. Pick one and save: it saves, and the timetable shows her.
2. Open a period «بدون معلم», change only the day or slot, and save **without** a teacher. It saves (the payload has `teacherId: null`).
3. Open a period of a subject **with** assigned teachers. Only those teachers are listed, as before.
4. Pick a teacher who already has a period in the same day and slot. The 409 message shows and nothing is saved.
5. Clear the teacher of a period and save. The timetable shows «بدون معلم».
