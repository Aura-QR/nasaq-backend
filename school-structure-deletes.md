# Deleting a Year, Term, Class or Subject — Web & Mobile Handoff

For the web (React) and mobile (Flutter) developers. **The backend is done
and deployed** (backend `76588e9`). All UI copy stays in formal Arabic.

## What changed

These four deletes used to remove the one row and leave everything that
pointed at it:

- the academic year;
- the term («الفصل الدراسي»);
- the class («الفصل»);
- the subject in a grade (subject offering).

**What went wrong.** A deleted year left its subjects, timetable and teacher
assignments behind. The exam form then listed last year's subject. A final
set on it went to last year's classes, so none of this year's students
could see it.

**Now each delete does one of two things:**

1. **Removes what belongs under it:** the timetable periods, teacher
   assignments, grade distributions (when no exam uses them) and teacher
   availability.
2. **Or is refused with 409,** if anything that is real work hangs off it:
   - exams, projects or lesson plans;
   - digital content;
   - daily tracking or attendance;
   - students or enrolments;
   - financial records or expenses.

   The message says exactly what is there. For example:
   > «لا يمكن حذف الفصل الدراسي: يرتبط بها 3 اختبار، 12 سجل متابعة. احذفها أولًا، أو أرشف السنة بدلًا من حذفها.»

## What to build

- **Show the 409 message as it comes**, wherever these four can be deleted:
  - the academic year settings;
  - terms;
  - classes;
  - the subjects of a grade.
- **Update the confirmation text** before delete. For example:
  «سيُحذف معه جدول الحصص وإسنادات المعلمين المرتبطة به. ولا يمكن الحذف إن
  وُجدت درجات أو غياب أو تحاضير مرتبطة.»
- The year delete's success response now also reports `subjectOfferings`
  and `teacherAssignments` under `deleted`.

## Cleaning up a school (optional, admin screen)

`POST /academic-years/leftovers/cleanup` (OWNER or SUPERVISOR) clears what
earlier deletes left behind.

- **Request body:**
  - `{}` is a **dry run**: it changes nothing and returns `wouldRemove`.
  - `{ "commit": true }` actually removes, and returns `removed`.
- **The response** also has `kept`: a list of Arabic lines, one for each old
  item that was kept because it still holds work.
- **A suggested button** on the academic year settings:
  «تنظيف بقايا السنوات المحذوفة».
  1. Run the dry run first.
  2. Show the counts.
  3. Then confirm and send `commit: true`.
