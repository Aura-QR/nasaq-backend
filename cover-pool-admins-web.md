# Supervisors and Managers as Cover (احتياط) — Web Handoff

For the web (React) developer. **Backend is done and deployed.** Nothing
below needs a backend change. Arabic labels below are the ones to use; keep
all UI copy in formal Arabic.

> **Update, 5 Oct 2026:** only **administrative assistants (MANAGER)** join
> the cover pool. **SUPERVISOR is the principal (مدير المدرسة) and is never a
> substitute** — the backend no longer offers or accepts them. Labels:
> `MANAGER` → «إداري/ة», `SUPERVISOR` (old rows only) → «مدير المدرسة». The
> picker heading is «المساعدون الإداريون».

## What changed

The school is short of free teachers, so an absent teacher's period can now be
given to an **administrative assistant (MANAGER)** from the Admin accounts,
as well as to a teacher.

- **Who can be chosen:** teachers and MANAGER accounts. The **OWNER**, the
  **principal (SUPERVISOR)** and **STAFF** (guards, cleaners) are never
  offered, and the backend refuses them.
- **Order:** every free teacher first (subject specialists at the top), then
  administrative assistants in name order. A teacher teaches the lesson; an
  administrator supervises the room.
- **Who counts as available:** an administrator is offered unless
  1. she has an **approved staff leave** that day, or
  2. some administrators have already checked in today (staff attendance)
     and she is not one of them.
- **Fairness:** cover taken by an administrator counts in the cover report
  like a teacher's.
- **Notification:** the administrator receives `cover_assigned` /
  `cover_removed`, the same as a teacher.
- **Recording:** the covering administrator can take attendance and daily
  tracking for that period on that day. A MANAGER does not have
  `dailyTracking.add` by default, so the backend allows it **only for the
  period she is covering**.

## API changes (all backwards compatible)

### `GET /duty/coverage` — each item in `uncovered[].suggestions`

```json
{
  "teacherId": "6650…",        // a Teacher id OR an Admin id. Post it back unchanged.
  "name": "أ. نورة",
  "specialization": null,       // always null for an administrator
  "sameSubject": false,         // always false for an administrator
  "type": "Admin",              // NEW: "Teacher" | "Admin"
  "role": "MANAGER"             // NEW: "TEACHER" | "MANAGER"
}
```

Each item in `covered[]` also has `substituteType` and `substituteRole`.

### `POST /duty/substitutions`

**No change.** Send the suggestion's `teacherId` as `substituteTeacherId`,
whether it is a teacher or an administrator. The server works out which.
The response row has `substituteType` and `substituteRole`.

### `GET /duty/cover-report` — each row in `teachers[]`

Has `type` and `role`. For an administrator, `neededCover`,
`approvedLeaves` and `daysPresent` are always `0`, because those figures
describe teachers.

### `GET /duty/my-day?date=YYYY-MM-DD`

Already works for a MANAGER. They have no timetable, so every
slot is `kind: "cover"`:

```json
{ "kind": "cover", "lectureId": "…", "slot": 3, "className": "٢/أ",
  "roomNumber": "12", "subjectName": "الرياضيات", "coveringFor": "أ. أروى" }
```

## Tasks

### 1. Cover board picker: `src/pages/School/Duty/CoverageBoard.jsx` (~line 745)

- Split the list into two groups. Teachers first, as today. Then a heading
  **«المساعدون الإداريون»** with the `type === "Admin"` suggestions.
- For an administrator, show the role in place of «بدون تخصص»:
  `MANAGER` → **«إداري/ة»** (and `SUPERVISOR` → «مدير المدرسة» on old rows).
- The `onPick(suggestion.teacherId)` call stays as it is.
- In the covered list (~line 710), add the same role chip next to
  `substituteTeacherName` when `substituteType === "Admin"`.

### 2. Cover report: `src/pages/School/Duty/CoverReport.jsx`

- Add the role chip for rows where `type === "Admin"`.
- Show **«—»** in place of the `0` in that row's `neededCover`,
  `approvedLeaves` and `daysPresent` columns.

### 3. New page for the covering administrator: «حصص الاحتياط»

- **Route:** `/school/my-cover`, for **MANAGER** only (the owner and the
  principal are never substitutes).
- **Sidebar:** add «حصص الاحتياط» for those two roles.
- **Data:** `GET /duty/my-day?date=` with a date picker defaulting to today
  (`fetchMyDay` in `src/APIs/school/notifications.js` already does this).
- **Each card:** «الحصة {slot} · {className}», then subject and room, then
  «بدلًا من {coveringFor}».
- **Button:** **«رصد الحضور والمتابعة»** → task 4.
- **Empty state:** «لا توجد حصص احتياط مكلّف بها في هذا اليوم».
- **Reference:** the cover cards in `src/pages/TeacherDuty/TeacherDuty.jsx`
  (`MyDay` component), which already have this button for teachers.

### 4. Register for the covering administrator

`src/pages/TeacherAttendance/TeacherAttendance.jsx` already handles a covered
period: it lists that date's cover periods from `/duty/my-day`, labelled
«احتياط عن …». For an administrator, the "own lectures" request returns an
empty list, so only her cover periods show.

- Mount the same component on an admin route, e.g. `/school/cover-register`,
  for MANAGER.
- Point the button from task 3 at
  `/school/cover-register?lectureId=<lectureId>&date=<YYYY-MM-DD>`.
- On that route, change the two header buttons that assume a teacher:
  - «لوحة التحكم» currently goes to `/teacher/dashboard`. Send it to
    `/school/my-cover`.
  - «التقرير الشهري» (`/teacher/daily-tracking`): hide it.
- Check that `resolveTeacherId` returns the admin's own `_id` for an admin
  login. It falls back to `currentUser._id`. If the page shows «تعذر تحديد
  حساب المعلم الحالي», that is why.

### 5. Notification bell: `src/components/Notifications/NotificationBell.jsx`

In the `SCHOOL_ADMIN` map, `cover_assigned` and `cover_removed` go to
`/school/duty` (the board). Only the substitute ever receives these, so send
them to **`/school/my-cover`**.

## How to test (QA school)

1. As the owner, open the cover board on a day with an absent teacher. The
   assistant appears **after** all free teachers, with «إداري/ة».
2. Assign her. The period moves to «covered» with her name and role.
3. Log in as that assistant. The bell shows «لديك حصة احتياط». It opens
   `/school/my-cover`, and the period is listed.
4. Press «رصد الحضور والمتابعة». The register opens on that period and
   date. Save attendance and daily tracking, and both succeed.
5. Change the date to the next day. The period is gone from the list.
   (A MANAGER without `dailyTracking.add` gets 403 saving tracking on a day
   she is not covering.)
6. The cover report for that day shows her with 1 covered.
