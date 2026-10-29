# Mobile: the new «طلب استئذان» notice for the school

**For:** Azza (`nasaq_mobile`). **Size:** one line, plus the alert list if the app has one.
**Backend:** `9a1263b`, live. **Web:** done (`2f9a30b`).

## What happened
A teacher's استئذان (`POST /duty/leave-requests`) was saved, but **nobody was notified**: there was no notice type for it. The school only saw it by opening the duty screen. This was reported on Yamamah on 29 Oct.

## What changed
New notice type **`leave_requested`**, sent to the school's administrators (owner, principal, and managers who can read «المناوبة والاحتياط») when a teacher files a leave request, or edits a pending one. It is **not** sent to the admin who filed it on the teacher's behalf. It arrives as a push too, through the usual `notify()`.

- Title: «طلب استئذان — {اسم المعلمة}», or «تعديل طلب استئذان — …» for an edit.
- Body: «2026-10-29 · انصراف 10:00 — {السبب}».
- `data`: `{ leaveRequestId, teacherId, teacherName, date, leaveAt }`.

## What to change in the app
In `lib/core/widgets/notification_bell.dart`, `_ownerRoutes`, next to `leave_approved`:
```dart
'leave_requested': Routes.ownerDuty,
```
This should open the screen where the school approves teacher leave requests (the one that calls `GET /duty/leave-requests`). If that is a tab inside the duty screen, open it on the leave tab.

Optional: give it the same icon and colour as `staff_leave_requested`, and, if the app pops alerts for the admin (as it does for `staff_leave_requested`), add `leave_requested` there too. It is time-bound: a teacher asking to leave at ten needs the answer before ten.

## Test (Yamamah or the QA school)
1. A teacher files a leave request from the app.
2. The school owner gets a push and a bell item «طلب استئذان — …».
3. Tapping it opens the leave requests screen. Approve the request: the teacher gets «تمت الموافقة على استئذانك» (this part already works).
