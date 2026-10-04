# Staff Absence Excuses (أعذار غياب الموظفين) — Web Handoff

For the web (React) developer. **Backend is done and deployed.** Keep all UI
copy in formal Arabic.

## What changed

Teachers could already explain a day they missed. **Supervisors, managers and
service staff (guards, cleaners) could not.** They now can, through the same
flow, plus one addition:

- **Self-service:** a MANAGER, SUPERVISOR or STAFF account explains their
  own absent day, with an optional attachment. The excuse waits for the
  school's review.
- **Entered by the school (new):** a cleaner may have no phone. The owner,
  or anyone with `staffAttendance` permission, enters the excuse on their
  behalf, and it is **accepted immediately**.
- **Review:** accept, reject (a note is required), or **mark present**. Mark
  present records their attendance for that day and closes the excuse, for
  someone who was on school business or forgot to check in.
- **Nobody acts on their own excuse.** They can't review it, mark it, or
  enter it for themself.
- **End-of-day notice:** 30 minutes after the school day ends, each staff
  member who did not check in gets «لم يُسجَّل حضورك اليوم». This only
  happens in schools with staff check-in enabled, and only for people who
  have checked in at least once.
- **Absence counts do not change.** An accepted excuse marks the absence; it
  does not remove it.

## API (all under `/staff-attendance`)

### The staff member's own (MANAGER, SUPERVISOR, STAFF)

| Method | Path | Notes |
|---|---|---|
| GET | `/me/absence-excuse/pending?days=14` | Absent days with no excuse: `[{ date }]`, newest first |
| GET | `/me/absence-excuses` | Their excuses and the outcome of each, including ones the school entered |
| POST | `/absence-excuse/attachment` | multipart `file` → `{ attachment: "/uploads/absence-excuses/…" }`. Also used by the school |
| POST | `/me/absence-excuse` | `{ date, reason, attachment? }` → status `pending` |

### The school's (permission `staffAttendance`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/absence-excuses` | create | `{ staffId, date, reason, attachment? }`. **Accepted at once.** Not for yourself |
| GET | `/absence-excuses?status=&from=&to=&staffId=` | read | `status` defaults to `pending`; also `accepted`, `rejected`, `marked_present` |
| PATCH | `/absence-excuses/:id/review` | update | `{ verdict: "accepted"\|"rejected", note? }`. `note` is required on reject |
| PATCH | `/absence-excuses/:id/mark-present` | update | `{ checkInAt?: "HH:mm", note? }`. Defaults to the day's start time, so no lateness |

`staffId` for the POST comes from `GET /staff-attendance/staff`, which already
lists managers, supervisors and service staff.

### Row shape (all list/response endpoints)

```json
{
  "id": "…", "staffId": "…", "staffName": "أم محمد", "role": "STAFF",
  "date": "2026-09-27", "reason": "…", "attachment": null,
  "status": "pending", "submittedAt": "…",
  "enteredBySchool": false, "recordedByName": null,
  "reviewedByName": "", "reviewedAt": null, "reviewNote": ""
}
```

### Errors to show as returned

- `400`: a future day, «هذا اليوم ليس يوم عمل», «يوجد سجل حضور في هذا
  اليوم» (that day needs a late reason instead), or a rejection without a
  note.
- `403`: acting on your own excuse.
- `404`: not a staff member of this school.
- `409`: an excuse already exists for that day, or it was already reviewed.

### Monthly summary

`GET /staff-attendance/summary` rows now include **`daysExcused`**. Show it
next to `daysAbsent`, e.g. «غياب ٣ (منها ١ بعذر)». `daysAbsent` is unchanged.

### Notifications (3 new types)

| Type | Who gets it | Send them to |
|---|---|---|
| `staff_absence_excuse_required` | the absent staff member | their excuse page (task 1) |
| `staff_absence_excuse_submitted` | owner, managers, supervisors (not the sender) | the review page (task 2) |
| `staff_absence_excuse_reviewed` | the staff member | their excuse page (task 1) |

## Tasks

The teacher version of each screen already exists. Copy it.

### 1. The staff member's page: «أعذار الغياب»

- **Route:** `/staff-absence-excuses`, inside the existing
  MANAGER/SUPERVISOR/STAFF block in `src/app/AppRouter.jsx`, next to
  `/staff-leave-requests`. Add it to their sidebar.
- **Reference:** `src/pages/TeacherAbsenceExcuses/MyTeacherAbsenceExcuses.jsx`.
- **Card at the top:** «أيام غياب تحتاج إلى توضيح» from `/me/absence-excuse/pending`.
  Each day has a «توضيح السبب» button that opens a form with a reason and an
  optional attachment.
- **Below the card:** the list from `/me/absence-excuses`, with a status chip
  for each:
  - `pending` → «قيد المراجعة»
  - `accepted` → «مقبول»
  - `rejected` → «مرفوض» + the note
  - `marked_present` → «سُجِّل حضورًا»

  When `enteredBySchool` is true, add «سجّلته الإدارة».

### 2. The school's review page: «أعذار غياب الموظفين»

- **Route:** `/school/staff-absence-excuses`, wrapped in
  `RequirePermission module="staffAttendance" operation="read"`, next to
  `/school/staff-late-reasons`. Add it to the sidebar there.
- **Reference:** `src/pages/TeacherAbsenceExcuses/TeacherAbsenceExcuses.jsx`.
- **Layout:** status tabs (pending / accepted / rejected / marked present),
  a date range, and a staff filter.
- **Row actions:** «قبول», «رفض» (requires a note), «تسجيل حضور».
- **Button «تسجيل عذر لموظف»:** opens a dialog for task 3.

### 3. Entering an excuse for someone (the request from the school)

Dialog fields:
- **«الموظف»:** select from `GET /staff-attendance/staff`.
- **«التاريخ»:** a date input.
- **«سبب الغياب»:** required.
- **«مرفق»:** optional, uploaded first via `/absence-excuse/attachment`.

Submit to `POST /staff-attendance/absence-excuses`. On success show «تم
تسجيل عذر الغياب واعتماده» and refresh the «مقبول» tab. Hide the current
user from the staff list, because the server refuses entering for yourself.

### 4. Monthly staff report

Wherever `daysAbsent` is shown from `/staff-attendance/summary`, show
`daysExcused` next to it.

### 5. Notification bell: `src/components/Notifications/NotificationBell.jsx`

Add the three types to the maps, using the destinations in the table above.
For the admin map, `staff_absence_excuse_required` and
`staff_absence_excuse_reviewed` go to `/staff-absence-excuses` (the person's
own page). `staff_absence_excuse_submitted` goes to
`/school/staff-absence-excuses`.

## How to test (QA school, staff check-in enabled)

1. Log in as the QA guard (`guard51851`) on a day after he skipped check-in.
   «أعذار الغياب» lists the day. Submit a reason. The owner's bell shows
   «عذر غياب …».
2. As the owner, open «أعذار غياب الموظفين» and accept it. The guard sees
   «مقبول».
3. As the owner, choose «تسجيل عذر لموظف» for another absent day. It
   appears directly under «مقبول», marked «سجّلته الإدارة».
4. Try to enter an excuse for a day the person checked in. You get the
   «يوجد سجل حضور» error.
5. On a pending excuse, choose «تسجيل حضور». The day shows as present in
   staff attendance, and the excuse moves to «سُجِّل حضورًا».
