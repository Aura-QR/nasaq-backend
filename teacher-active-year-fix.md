# Teacher Pages Scoped to the Active Academic Year — Backend Reply

For the web and mobile developers. This replies to
«Teacher Pages Return Data Across Academic Years» (2026-10-11).
**The backend is done and deployed** (backend `1ac72c8`).

## Root cause
The report was right. In the test school:

| Lecture | Class | Term | Term's year |
|---|---|---|---|
| `6acb3e52…` | G9 | `6acb347c…` | `6acb346c…` «2028», **active** |
| `6ac75663…` | م1/أ | `6a8e89cd…` | `6a8e89bf…` «2027/2028», **archived** |

Five services each found "the active term" with
`Term.findOne({ status: 'active' })`. Both terms are «upcoming», so they
found none and **applied no filter**, and every year came back. `GET
/lectures?teacherId=` never filtered by year at all.

## The fix
One resolver, `src/terms/current-scope.util.ts`, works from real relations:
1. **The year:** the one with `status: 'active'`.
2. **Its terms:** found by `Term.academicYearId`, never by term name, which
   repeats across years.
3. **The current term among them:** one marked active; else the one today
   falls in; else the most recent to have started; else the next to start.

**It scopes automatically. The frontend does not need to send anything.**

| Endpoint | Default now | To reach history |
|---|---|---|
| `GET /lectures?teacherId=` (and any call without `termId` or `classId`) | Every term of the active year | `academicYearId=` or `termId=` |
| `GET /lectures/teacher/me`, `/lectures/student/me` | The current term | `termId=` or `academicYearId=` (teacher) |
| `GET /classes/teacher/me` | The active year | `termId=` |
| `GET /duty/my-day`, the cover board, the classroom round | The current term for that date | — |
| `GET /preparation/weekly` | The term that week falls in | `termId=` |
| `GET /subjects/teacher/me` | Active-year subjects | — |
| `GET /teacher-assignments?teacherId=` (feeds the exam and project forms) | Active-year offerings | `termId=` or `academicYearId=` |
| `GET /exams` and `/exams/teacher/me` (teacher), `GET /projects` and `/projects/teacher/me` | Active-year offerings, **applied before counting and paging** | `subjectOfferingId=` or `academicYearId=` |

- **`academicYearId`** is validated within the caller's school; another
  school's year returns 400.
- **Lecture responses** now carry `termId.academicYearId`.
- **A new year with no lectures, or no terms yet,** returns an empty list,
  never last year's.
- **An old deep link** to a previous year's lecture still opens. Saving daily
  tracking on it returns **409**:
  «هذه الحصة من عام دراسي غير العام الحالي؛ لا يمكن الرصد عليها».

## Frontend changes
- **None required.** Remove any client-side year filtering that existed only
  to work around this; the server now does it.
- **Optional:** a «previous years» view can pass `academicYearId`.

## Tests
`src/terms/current-scope.spec.ts` rebuilds the report's case: two years,
every term «upcoming», one teacher with a lecture in each, and a term name
repeated across years. Covered:
- A1: the active year only.
- A2 and A7: a named year or term reaches history.
- A3: timetable, classes and assignments.
- A5: tracking refused on an old lecture.
- A9: an empty new year, and a year with no terms.
- A10: the repeated term name.
- The current-term choice in all four cases.

The full suite passes apart from three suites that already failed locally
before this change, and the app boots.
