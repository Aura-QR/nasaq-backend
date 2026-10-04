# Staff Absence Excuses (أعذار غياب الموظفين) — Mobile Handoff

For the mobile (Flutter) developer. **Backend is done and deployed.** Keep all
UI copy in formal Arabic. The backend is the same as for the web; this doc
names the mobile files.

## What changed

Teachers could already explain a day they missed. **Supervisors, managers and
service staff (guards, cleaners) could not.** They now can, plus one
addition:

- **Self-service:** a MANAGER, SUPERVISOR or STAFF account explains their
  own absent day, with an optional attachment. The excuse waits for review.
- **Entered by the school (new):** a cleaner may have no phone. The owner,
  or anyone with `staffAttendance` permission, enters the excuse on their
  behalf, and it is **accepted immediately**.
- **Review:** accept, reject (a note is required), or **mark present**. Mark
  present records the day's attendance and closes the excuse.
- **Nobody acts on their own excuse.**
- **End-of-day notice:** 30 minutes after the school day ends, each staff
  member who did not check in gets «لم يُسجَّل حضورك اليوم». This only
  happens when staff check-in is enabled, and only for people who have
  checked in before.
- **Absence counts do not change.** An accepted excuse marks the absence.

## API (all under `/staff-attendance`)

### The staff member's own (MANAGER, SUPERVISOR, STAFF)

| Method | Path | Notes |
|---|---|---|
| GET | `/me/absence-excuse/pending?days=14` | `[{ date }]`, newest first |
| GET | `/me/absence-excuses` | Their excuses and the outcome of each |
| POST | `/absence-excuse/attachment` | multipart `file` → `{ attachment }`. Also used by the school |
| POST | `/me/absence-excuse` | `{ date, reason, attachment? }` → `pending` |

### The school's (permission `staffAttendance`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/absence-excuses` | create | `{ staffId, date, reason, attachment? }`. **Accepted at once.** Not for yourself |
| GET | `/absence-excuses?status=&from=&to=&staffId=` | read | `status` defaults to `pending` |
| PATCH | `/absence-excuses/:id/review` | update | `{ verdict, note? }`. `note` is required on reject |
| PATCH | `/absence-excuses/:id/mark-present` | update | `{ checkInAt?: "HH:mm", note? }` |

The staff list for the picker comes from `GET /staff-attendance/staff`.

### Row shape

```json
{ "id": "…", "staffId": "…", "staffName": "أم محمد", "role": "STAFF",
  "date": "2026-09-27", "reason": "…", "attachment": null,
  "status": "pending|accepted|rejected|marked_present",
  "submittedAt": "…", "enteredBySchool": false, "recordedByName": null,
  "reviewedByName": "", "reviewedAt": null, "reviewNote": "" }
```

Show error messages exactly as the server returns them (`400` / `403` /
`404` / `409`).

`GET /staff-attendance/summary` rows now include **`daysExcused`**, shown
next to `daysAbsent`.

### Notifications (3 new types)

| Type | Who gets it |
|---|---|
| `staff_absence_excuse_required` | the absent staff member |
| `staff_absence_excuse_submitted` | owner, managers, supervisors (not the sender) |
| `staff_absence_excuse_reviewed` | the staff member |

## Tasks

The teacher version of each piece already exists. Copy it.

1. **Repository.** Add a `StaffAbsenceExcuseRepository` that mirrors
   `lib/teacher/data/repositories/teacher_absence_excuse_repository.dart`,
   pointed at the endpoints above.
2. **Staff member's side**, in `lib/staff_attendance/`:
   - **Pending days card** on `staff_check_in_screen.dart`. Model it on
     `lib/teacher/presentation/widgets/absence_excuse/pending_absence_excuses_card.dart`:
     each day has «توضيح السبب», which opens a reason field and an optional
     attachment.
   - **A «أعذار غيابي» screen** next to `staff_my_late_reasons_screen.dart`,
     listing `/me/absence-excuses` with a status label for each:
     - `pending` → «قيد المراجعة»
     - `accepted` → «مقبول»
     - `rejected` → «مرفوض» + the note
     - `marked_present` → «سُجِّل حضورًا»

     When `enteredBySchool` is true, add «سجّلته الإدارة».
3. **School's review queue.** Reuse `AttendanceReviewsScreen` and
   `AttendanceReviewsCubit` with a new `ReviewQueue.staffAbsence`, the same
   way `ReviewQueue.teacherAbsence` is wired in `routes.dart`
   (`ownerTeacherAbsenceExcuses`):
   - Actions: «قبول», «رفض» (requires a note), «تسجيل حضور».
   - Add the route and a sidebar entry in
     `owner/presentation/models/sidebar_config.dart`, next to
     `staff_late_reasons_screen.dart`'s entry, behind
     `PermissionHelper.can('read', 'staffAttendance')`.
4. **«تسجيل عذر لموظف».** This is the school's request: a cleaner with no
   phone.
   - Add a button on that queue screen, behind
     `PermissionHelper.can('create', 'staffAttendance')`.
   - Form fields: staff picker (`/staff-attendance/staff`, excluding the
     logged-in user), date, reason (required), optional attachment.
   - Submit with `POST /staff-attendance/absence-excuses`. On success show
     «تم تسجيل عذر الغياب واعتماده».
5. **Staff report** (`staff_report_screen.dart`): show `daysExcused` next to
   the absence count.
6. **Notification bell** (`core/widgets/notification_bell.dart`):
   - **Staff map (~line 90):** `staff_absence_excuse_required` and
     `staff_absence_excuse_reviewed` go to the new «أعذار غيابي» screen.
     A STAFF login uses this map.
   - **Owner map (~line 62):** `staff_absence_excuse_submitted` goes to the
     new queue.
   - **Managers and supervisors use the owner map**, but they can also
     receive `_required` and `_reviewed` about themselves. Route those to
     «أعذار غيابي». The existing comment at ~line 50 explains the same rule
     for staff late reasons.
   - Add icons and colours for the three types.

## How to test (QA school, staff check-in enabled)

1. Log in as the QA guard (`guard51851`) after a day he skipped check-in.
   The pending card lists the day. Submit it. The owner's bell shows
   «عذر غياب …».
2. As the owner, accept it in the queue. The guard's «أعذار غيابي» shows
   «مقبول».
3. As the owner, choose «تسجيل عذر لموظف» for another absent day. It shows
   under accepted, marked «سجّلته الإدارة».
4. On a pending excuse, choose «تسجيل حضور». The day appears in staff
   attendance as present.
