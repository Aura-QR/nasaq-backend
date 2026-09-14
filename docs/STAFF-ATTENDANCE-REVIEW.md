# Staff Attendance — Review

> Reviewed: backend `e13cc1c` (feat: added self attendance for managers), frontend `7612cf4` (add adent), re-checked against frontend `d6b4b6c` (fix: centralize shared attendance settings) — both issues are still present there; line numbers below are for `d6b4b6c`.
> Date: 2026-09-14. Status: **findings only, nothing changed yet.**

## Summary

Self check-in and check-out for `MANAGER` and `SUPERVISOR` works: location verification, duplicate protection, lateness in the school's timezone, absence list, and period summary all behave correctly.

Three problems should be fixed (the third is in the existing teacher attendance, found along the way):

| # | Severity | Problem |
|---|---|---|
| 1 | **High** | Any assistant can create, edit or delete attendance records — their own included — with no location. Self check-in by location can be bypassed entirely. |
| 2 | **Medium** | The admin "edit record" dialog opens with empty time fields and refuses to save a normal day. |
| 3 | **High** | Found while checking issue 2, in the older **teacher** attendance (live today): a manually entered or corrected time is stored 3 hours late, and the teacher is reported late by those 3 hours. |

Plus three smaller notes (mobile, displayed names, permissions plan).

---

## What was verified

**Build and tests**
- Backend `tsc --noEmit`: clean.
- `staff-attendance.spec.ts` + `teacher-attendance.spec.ts`: 46/46 passing.
- Frontend `vite build`: clean.

**Live run.** Built backend on a throwaway database; school, settings and two manager accounts created through the API. Location set to `24.7136, 46.6753`, radius 150 m, `staffCheckInEnabled: true`.

| Scenario | Result | Expected |
|---|---|---|
| Manager checks in 15 m from school | 200, `method: location`, `gps: true` | ✅ |
| Manager checks in 5,159 m away | 403 with the distance in the message | ✅ |
| Same manager checks in again | 409 «تم تسجيل الحضور لهذا اليوم بالفعل» | ✅ |
| Manager checks out | 200 | ✅ |
| Owner tries self check-in | 403 (owner is not in scope, by design) | ✅ |
| Absence list | lists the manager with no record | ✅ |
| Notes-only `PATCH` on a location record | keeps `method: location`, `gps: true` | ✅ |

Test database dropped afterwards. Production was not touched.

---

## 1. Assistants can write their own attendance (High)

### What happens

Every management endpoint is open to `MANAGER`:
- manual entry
- edit
- delete
- staff list
- absence list
- summary

A manager can therefore record, move or erase attendance for any manager or supervisor, **including themselves**, without being at school.

### Reproduced

Signed in as manager 2:

| Request | Result |
|---|---|
| `POST /staff-attendance` with **their own** `staffId`, check-in one hour ago, no coordinates | **201 — «تم تسجيل الحضور يدويًا»** |
| `PATCH /staff-attendance/:id` on manager 1's record, moving check-in earlier | **200 — «تم تعديل سجل الحضور»** |
| `DELETE /staff-attendance/:id` on manager 1's record | **200** — manager 1 now appears in the absence list |

### Why it matters

- **Self-recorded attendance:** someone absent records a manual check-in for themselves.
- **Hidden lateness:** someone late edits their own check-in time.
- **Harm to a colleague:** anyone can delete a colleague's day and mark them absent.

Any of these makes the location check pointless, and the report can no longer be trusted by the owner.

### Where

- Backend — `src/staff-attendance/staff-attendance.controller.ts:31`: class-level `@Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)` applies to:
  - `GET /staff` (`:70`)
  - `GET /absent` (`:86`)
  - `GET /summary` (`:94`)
  - `GET /` (`:102`)
  - `POST /` (`:108`)
  - `PATCH /:id` (`:119`)
  - `DELETE /:id` (`:129`)
- Backend — `staff-attendance.service.ts`:
  - `createManual` (`:273`), `update` (`:501`) and `delete` (`:558`) have no check on who the record belongs to.
  - They also don't check who is calling.
- Docs — `docs/STAFF_ATTENDANCE_FRONTEND_INTEGRATION.md:38` states this as intended: all three roles may create, edit and delete for everyone, "including their own records".
- Frontend — the admin page is shown to managers:
  - `src/components/Sidebar/Sidebar.jsx:209`: `canManageSchoolSettings` includes `MANAGER`; the item is at `:382`.
  - `src/components/school/SchoolSidebar.jsx:151`: `allowedRoles` includes `MANAGER`.
  - Route `/school/staff-attendance` sits under `SCHOOL_ADMIN_ROLES` (`src/app/AppRouter.jsx:309`).

### Proposed fix

| Action | OWNER | SUPERVISOR | MANAGER |
|---|---|---|---|
| Self check-in / check-out by location, own history (`/check-in`, `/check-out`, `/me`) | — | ✅ | ✅ |
| View records, absence list, summary | ✅ | ✅ | ❌ (until job titles grant it, see note 3) |
| Manual entry, edit, delete | ✅ | ✅ | ❌ |
| **Manual entry / edit / delete on one's own record** | — | ❌ | ❌ |

**Backend**
1. On `staff`, `absent`, `summary`, `GET /`, `POST /`, `PATCH /:id` and `DELETE /:id`, set `@Roles(Role.OWNER, Role.SUPERVISOR)`. The handler-level decorator overrides the class one, because `RolesGuard` uses `getAllAndOverride`.
2. In the service, refuse when the target record's `staffId` equals `user.userId`:
   - on `createManual` (target is `dto.staffId`)
   - on `update` and `delete` (target is `record.staffId`)

   Message: «لا يمكن تسجيل أو تعديل أو حذف حضورك بنفسك. اطلب ذلك من مالك المدرسة.»

   This stops a supervisor from editing their own record.
3. Update `STAFF_ATTENDANCE_FRONTEND_INTEGRATION.md` section 2 to match.

**Frontend**
1. Show «حضور الإداريين والمشرفين» to `OWNER` and `SUPERVISOR` only: in both sidebars, and wrap the route in a `RoleRoute` with those two roles.
2. «حضوري» stays for `MANAGER` and `SUPERVISOR`.
3. In the admin page, hide the edit/delete actions on the signed-in user's own row (the server refuses them anyway).
4. The «تفعيل حضور الإداريين والمشرفين» toggle lives on this page (`saveSettings`, `:699`), so today any assistant can switch staff self check-in off for the whole school. Hiding the page from assistants covers it; keep the toggle for `OWNER` / `SUPERVISOR` only.

**Tests to add** (`staff-attendance.spec.ts`)
- `MANAGER` → 403 on:
  - `POST /`, `PATCH /:id`, `DELETE /:id`
  - `GET /`, `GET /absent`, `GET /summary`, `GET /staff`
- `SUPERVISOR` → refused on `createManual`, `update` and `delete` for their own `staffId`; allowed for another staff member.
- `OWNER` → allowed on all of them.
- `MANAGER` → still allowed on `check-in`, `check-out`, `me`.

---

## 2. Edit dialog shows empty times and refuses to save (Medium)

### What happens

1. A record with check-in 07:45 and check-out 14:00 (Riyadh) is opened with «تعديل».
2. **Both time fields appear empty.**
3. The owner changes only the note and presses save. The dialog shows **«وقت الانصراف لا يمكن أن يسبق وقت الحضور»** and does not save.

### Reproduced

The dialog's own functions were run on that record:

```
dialog values:                 {"checkInAt":"07:45 ص","checkOutAt":"02:00 م","notes":"ملاحظة"}
valid for <input type=time>:   false false
blocked by the order check:    true
converted checkInAt:           ""
```

### Why

- `src/pages/School/StaffAttendance/StaffAttendanceAdmin.jsx:281` `formatTime` formats with `ar-EG-u-nu-latn`. That locale uses a 12-hour clock with an Arabic day-period suffix: `"07:45 ص"`, `"02:00 م"`. It is correct for display in the table.
- `openEditDialog` (`:778`) reuses `formatTime` to **prefill `<input type="time">`**, which only accepts `HH:mm`. The browser renders the invalid value as empty.
- `saveEdit` (`:794`, check at `:812`) compares the two strings. `"02:00 م" < "07:45 ص"` is `true` as text, so any afternoon check-out whose 12-hour digits sort below the check-in is rejected. Most normal school days fail this check.
- If the check were skipped, `zonedLocalToIso` (`:85`) would get `NaN` minutes and return `""`. `updateStaffAttendance` (`src/APIs/school/staffAttendance.js:249`) drops empty values, so the untouched times would silently not be sent. That part is harmless.

### Proposed fix

1. Add a separate helper for form values that returns 24-hour `HH:mm` in the school's timezone, e.g. `Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`. Use it in `openEditDialog`. Keep `formatTime` for display.
2. In `saveEdit`, send `checkInAt` / `checkOutAt` only when the value differs from what the dialog opened with. Otherwise a note edit converts a location-verified record into `method: manual` and clears its coordinates, because the backend `update` resets verification whenever `checkInAt` is present.
3. The order check then compares `HH:mm` strings, which sort correctly.

**Test to add:** a pure test for the form-value helper, and one proving a notes-only save sends no times.

---

## 3. Teacher attendance: manual times are stored 3 hours late (High, live)

This is in `teacher-attendance`, not the new staff module, but it surfaced while comparing the two edit dialogs.

### What happens

The owner records a manual check-in for a teacher at **07:45** (school on `Asia/Riyadh`, day starting 07:30):
- The record is saved as **10:45** Riyadh time.
- It shows **195 minutes late** instead of 15.

The same happens when correcting a time from the edit dialog.

### Reproduced

Running the backend's own helpers from the built code:

```
typed 07:45 -> 2026-09-14T07:45:00.000Z   shown in Riyadh as 10:45   late minutes vs 07:30: 195
prefilled "07:45 ص" -> Invalid Date
```

### Why

- The frontend sends the time as a bare `"HH:mm"`:
  - manual entry: `TeacherAttendanceAdmin.jsx:843` → `createManualTeacherAttendance`, payload `checkInAt: "07:45"`
  - edit: `saveEdit` `:872` sends `editForm` as is
- The backend reads it with `parseCheckInTime` (`src/attendance/attendance.utils.ts`), used by:
  - `teacher-attendance.service.ts:189` (manual)
  - `:612` and `:626` (update)
- For `"HH:mm"`, `parseCheckInTime` builds the instant with `Date.UTC(...)`, i.e. 07:45 **UTC**, which is 10:45 in Riyadh.
- Lateness is then computed correctly in the school's timezone, from that wrong instant.
- The teacher edit dialog also has issue 2's prefill problem:
  - `openEditDialog` `:859` fills the inputs with `formatTime` → `"07:45 ص"`.
  - `parseCheckInTime` turns that into `Invalid Date`, so saving without retyping both times fails.

The staff module does not have this bug. It requires ISO instants with an offset and converts on the client with `zonedLocalToIso`.

### Proposed fix

**Backend**
- `parseCheckInTime(date, "HH:mm")` must read the time as wall-clock time **in the school's timezone**, not UTC. Pass `settings.timezone` in and convert the same way `zonedLocalToIso` does.
- Reject anything else that parses to `Invalid Date` with a 400 instead of saving it.

**Frontend**
- Edit dialog: prefill with 24-hour `HH:mm` (same helper as issue 2).
- Only send times that changed.

**Existing data.** Every teacher record created or corrected by hand so far (`method: 'manual'`, or any record edited through `PATCH`) may be 3 hours off, with inflated `lateMinutes`.
- Before changing it, run a read-only count of affected records per school.
- Then decide whether to correct them with a one-off script: subtract the school's UTC offset and recompute lateness.
- Records from location check-in are not affected.

**Tests to add**
- `parseCheckInTime` with `"07:45"` and `Asia/Riyadh` returns `04:45Z`.
- Manual entry at 07:45 against a 07:30 start gives `lateMinutes: 15`.
- An unparseable time returns 400.

---

## Smaller notes

### A. No mobile support
`nasaq_mobile` has no staff attendance screens. Managers and supervisors can check in from the web only. Location from a desktop browser is often imprecise (Wi-Fi/IP based); the school network IP list covers that case, but phones are the natural device. Decide whether a mobile «حضوري» screen is planned.

### B. Names are usernames
`staff-attendance.service.ts:213` and `:286` store `name: staff.username`, so records, the absence list and the summary show values like `najla12`. `Admin` has no display-name field today. Fine for now; worth a `name` field on `Admin` later.

### C. Permissions plan
These endpoints are role-based only, with no permission key. `docs/STAFF-JOB-TITLES-PLAN.md` now defines a `staffAttendance` key (section "Staff attendance"), so a job title can grant viewing the report without granting manual entry. Self check-in stays available to every assistant regardless of title.

---

## Fix order

1. **Issue 1 — implement it the job-titles way, not as a temporary patch.** Follow "Staff attendance → Shipping it early" in `docs/STAFF-JOB-TITLES-PLAN.md`:
   - a `staffAttendance` permission key, none for `MANAGER` by default
   - `@CheckAbilities` on the management endpoints
   - the own-record rule
   - the frontend gating

   The visible result matches the proposed fix above; job titles later need no rework.
2. **Issue 3**, backend + frontend. It corrupts live teacher data every time a time is entered by hand; count affected records before deciding on a correction script.
3. **Issue 2**, frontend only. Share the `HH:mm` prefill helper with issue 3's teacher dialog.

## Who needs to change what

| Issue | Backend | Frontend |
|---|---|---|
| 1 — assistants write their own attendance | permission key, `@CheckAbilities`, own-record rule, tests, integration doc | hide management page and toggle from assistants (sidebars + route), hide own-row actions |
| 2 — staff edit dialog | — | 24-hour prefill, send only changed times |
| 3 — teacher manual times 3 h late | `parseCheckInTime` in school timezone, reject invalid, tests, data count | 24-hour prefill in teacher edit dialog, send only changed times |
