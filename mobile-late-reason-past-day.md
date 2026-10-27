# Mobile: the late-reason dialog for an earlier day

**For:** Azza (`nasaq_mobile`). **Size:** two lines of text in `lib/core/widgets/attendance_alerts.dart`.
**Backend:** `0686aaf`, live. **Web:** done (`9786c9e`).

## What happened
At مواهب, a teacher was late on Monday and opened the notice «يُرجى بيان سبب التأخير» on Tuesday. The app took her to the check-in screen with nothing to answer: `GET /teacher-attendance/me/late-reason/pending` only looked at today, and on Tuesday she was on time.

## What changed in the backend
- `.../me/late-reason/pending` (teachers) and `/staff-attendance/me/late-reason/pending` (staff) now return the **latest unexplained lateness of the past 7 days**, with its `date` and a new field **`isToday`** (bool).
- The app already sends `pending.date` back with the reason (`attendance_alerts.dart`, around line 257), so submitting already works. Nothing to change there.
- New notices read «سُجّل تأخيرك بتاريخ 2026-10-26 مدة 7 دقيقة…» instead of «اليوم».

## What to change in the app
1. `PendingLateness`: read `isToday` (`json['isToday'] != false`; default true for older responses).
2. The dialog text (`attendance_alerts.dart`, lines ~553 and ~657), currently `'سُجّل تأخيرك اليوم ${lateMinutes} دقيقة. '`:
   - `isToday` → keep it as is.
   - Otherwise → `'سُجّل تأخيرك يوم {weekday day month} مدة ${lateMinutes} دقيقة. '`, e.g. «سُجّل تأخيرك يوم الاثنين 26 أكتوبر مدة 7 دقيقة.» (`DateFormat('EEEE d MMMM', 'ar')`).
3. Tapping a `late_reason_required` notice should open the dialog even if the teacher chose «لاحقًا» earlier (the bell already re-checks `pendingLateReason()` around line 557; just make sure a previous dismissal does not hide it).

## Test (QA school)
A teacher late yesterday with no reason and on time today: open the app, tap yesterday's notice → the dialog shows yesterday's date; send a reason → the school sees it under «أسباب التأخير» for yesterday.
