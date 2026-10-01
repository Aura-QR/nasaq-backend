# Teacher Absence Excuses — Mobile Update

For the Flutter developer. Covers **only what changed** since you built the
first version (commit `726a12d`), plus two bugs found while reviewing it.

**Backend is deployed.** Everything below works against production today.

Checklist — details for each follow:

- [ ] **Bug:** reviewed notification opens the wrong screen
- [ ] **Bug:** `409` on submit is shown as a red error and the sheet stays open
- [ ] New push type `teacher_absence_excuse_required`
- [ ] New status `marked_present` on the owner's review screen
- [ ] New action "كانت حاضرة" on the owner's review screen
- [ ] Pending list is now legitimately empty much more often
- [ ] One new `400` message on submit
- [ ] *(Optional)* work days on the teacher form

---

## Why this changed

At launch, nearly every teacher at مواهب المملكة was asked to explain days
she had not been absent — 27 of 27 about the national day (not entered as a
holiday), and a teacher on a school trip about a day she worked. The rules
are now fixed on the server. Most of what follows is the client catching up.

---

## 1. Bug — the reviewed notification opens the student attendance screen

`lib/core/widgets/notification_bell.dart`, line 72:

```dart
'teacher_absence_excuse_reviewed': Routes.teacherAttendance,
```

`Routes.teacherAttendance` now opens **`TeacherDailyTrackingScreen`** — the
students' daily tracking sheet (it was repointed when سجل المتابعة shipped).
A teacher tapping "your excuse was reviewed" lands on a class roster.

**Fix:**

```dart
'teacher_absence_excuse_reviewed': Routes.teacherAbsenceExcuses,
```

---

## 2. Bug — `409` is shown as a red error and the sheet stays open

`lib/teacher/presentation/widgets/absence_excuse/submit_absence_excuse_sheet.dart`,
lines 58–67:

```dart
backgroundColor: ColorsManager.errorColor,
...
if (state.message.contains('409') || state.message.contains('already')) {
  Navigator.of(context).pop();
}
```

The server's message is Arabic and contains neither:

```json
{ "status": false, "message": "تم إرسال عذر عن هذا اليوم بالفعل", "statusCode": 409 }
```

So the check never matches: the teacher sees a red error and the sheet
stays open on a day that is already done.

**Fix:** decide on the status code, not the text. Carry `statusCode` through
the cubit's failure state, then:

```dart
if (state.statusCode == 409) {
  // The day is already explained — not an error. Close and refresh.
  Navigator.of(context).pop();
  context.read<TeacherAbsenceExcuseCubit>().loadPending();
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(state.message)));
  return;
}
```

If threading `statusCode` through is awkward, matching `'بالفعل'` works as
a stopgap — but prefer the code.

---

## 3. New push — `teacher_absence_excuse_required`

Sent to a teacher **half an hour after her school's day ends**, if she
recorded no attendance that day. Once per teacher per day.

```json
{
  "type": "teacher_absence_excuse_required",
  "title": "لم يُسجَّل حضورك اليوم",
  "body": "2026-10-01 — إن كنت غائبًا فبيّن السبب، وإن كنت حاضرًا فأبلغ الإدارة.",
  "data": { "date": "2026-10-01" }
}
```

Add it to the three maps in `notification_bell.dart` (route, icon, colour)
and to the teacher's type list around line 671:

```dart
'teacher_absence_excuse_required': Routes.teacherAbsenceExcuses,
// icon: Icons.event_busy_outlined   colour: ColorsManager.statusWarning
```

Title and body are formal Arabic — show them as sent.

---

## 4. New status — `marked_present`

The school's answer to an excuse that says "I was not absent". Attendance
is recorded for that day and the excuse is closed. It is **not** an excused
absence.

`lib/owner/presentation/screens/attendance_reviews_screen.dart`, the status
list at lines 27–30:

```dart
(value: 'marked_present', label: 'سُجّلت حاضرة'),
```

Give its chip an info colour (not success, not error). `TeacherAbsenceExcuseReview.status`
already reads it as a plain string, so the model needs nothing.

---

## 5. New action — "كانت حاضرة"

A third button beside قبول and رفض, **teacher absence excuses only** (not
the student ones or latenesses that share this screen).

```
PATCH /teacher-attendance/absence-excuses/:id/mark-present
```

```json
{ "checkInAt": "07:00", "note": "رحلة مدرسية مع الطالبات" }
```

Both fields optional. Without `checkInAt` the day's start time is used, so
no lateness is recorded. Send nothing you don't have — `{}` is valid.

```json
{
  "status": true,
  "message": "سُجِّل حضور المعلم لهذا اليوم وأُغلق العذر",
  "data": { "id": "...", "status": "marked_present", "date": "2026-09-30" }
}
```

`409` if already ruled on — same handling as review: refresh, not an error.

**Repository** — `attendance_reviews_repository.dart`, beside the review call
at line 183:

```dart
Future<Either<String, void>> markTeacherAbsencePresent(
  String id, {String? checkInAt, String? note}) async {
  final result = await DioHelper.patchData(
    url: '/teacher-attendance/absence-excuses/$id/mark-present',
    data: {
      if ((checkInAt ?? '').isNotEmpty) 'checkInAt': checkInAt,
      if ((note ?? '').trim().isNotEmpty) 'note': note!.trim(),
    },
  );
  return result.fold((e) => Left(e), (_) => const Right(null));
}
```

**Dialog** — confirm text, an optional time picker labelled "وقت الحضور
(اختياري)" with helper "إن تُرك فارغًا يُعتمد وقت بداية الدوام", and an
optional note. The web version is in `TeacherAbsenceExcuses.jsx` if you want
to match it.

---

## 6. The pending list is empty far more often

`GET /teacher-attendance/me/absence-excuse/pending` — same route, same
shape. The server now leaves out:

| Left out | Why |
|---|---|
| Holidays and days off | Nobody is absent on a day off |
| Weekdays she doesn't work | See section 8 |
| Days before she first used check-in, or was hired | Before then, "no record" means "not using the app yet" |
| **Today, until the school day ends** | Before then she is not absent, she is not here yet |
| Everything, at a school without teacher check-in | No check-ins means everyone reads as absent |

**For you:** an empty list is the normal state — hide the card, don't show
an error. And **don't cache** the list across app launches; ask the server
each time the screen opens, because today's entry appears at a time of day.

---

## 7. One new `400` on submit

```
هذا اليوم ليس من أيام عملك
```

A weekday outside her work days. If your sheet already shows the server's
message for other `400`s, nothing to do.

---

## 8. *(Optional)* Work days on the teacher form

`Teacher.workDays` — `List<String>?`, on the existing create and update
teacher calls.

| Value | Meaning |
|---|---|
| `null` or `[]` | Every school day — **every existing teacher** |
| `['sunday', 'monday']` | Only those weekdays |

For a teacher who comes in on fewer days than the school. If you add it to
`teacher_details_screen.dart` / `add_teacher_helper.dart`: all unticked by
default, send `null` when none are ticked, compare as a set before deciding
it changed. The web already has it, so this is optional on mobile.

---

## How to test

Owner: `owner@nasaq.com` / `Password123!` (مواهب المملكة).

1. **Bug 1:** review any teacher excuse from the web, tap the push on the
   teacher's phone → must open the absence excuses screen.
2. **Bug 2:** as a teacher, submit an excuse for a day, then try the same day
   again → sheet closes, no red error.
3. **Mark present:** owner → أعذار غياب المعلمين → an excuse from جوهرة
   (29 or 30 Sept) → كانت حاضرة → it leaves "pending" and appears under
   "سُجّلت حاضرة".
4. **Pending list:** as any teacher, 23 and 24 Sept must not appear, and
   today must not appear before 13:10.
5. **Push:** a teacher with no check-in today gets it at 13:40 Riyadh.

Full API reference, unchanged parts included:
`teacher-absence-excuse-api-docs.md`
