# سجل المتابعة اليومي — Daily Tracking API

Handoff notes for the Web (React) and Mobile (Flutter) developers.

The teacher opens a period from her timetable and sees her class roster with
four checkboxes per student. She unticks the exceptions and presses save once.

**Two endpoints:** one GET that fills the whole screen, one POST that saves it.

---

## 1. Read the sheet

```
GET /attendance/lecture/:lectureId/sheet?date=YYYY-MM-DD
```

This is the **existing** attendance endpoint, now returning the behavioural
fields alongside the absences. If you already call it, you get the new fields
for free — nothing you read today has changed or moved.

| | |
|---|---|
| Auth | Bearer token |
| Permission | `school.attendance.create` |
| Teacher rule | Must be the teacher of this lecture, else `403` |
| `date` | Required, `YYYY-MM-DD` |

### Response `200`

```json
{
  "status": true,
  "message": "تم استرجاع كشف الحضور بنجاح",
  "data": {
    "lecture": {
      "_id": "6ab0000000000000000000bb",
      "dayOfWeek": "sunday",
      "slot": 3,
      "classId":  { "_id": "6ab0000000000000000000cc", "name": "٢/أ", "roomNumber": "12" },
      "subjectOfferingId": { "_id": "off1", "subjectId": { "subjectName": "الرياضيات" } },
      "teacherId": { "_id": "t1", "name": "أ. سارة" }
    },
    "date": "2026-09-29",
    "alreadyRecorded": true,
    "trackingRecorded": true,
    "students": [
      {
        "_id": "6ab000000000000000000001",
        "name": "سارة الأحمد",
        "schoolEmail": "sara@nasaq.edu",
        "absent": false,
        "participation": true,
        "homework": true,
        "quiz": null
      },
      {
        "_id": "6ab000000000000000000002",
        "name": "نورة العتيبي",
        "schoolEmail": "noura@nasaq.edu",
        "absent": true,
        "participation": false,
        "homework": false,
        "quiz": null
      }
    ]
  }
}
```

### The two "already saved" flags are different

| Field | Means |
|---|---|
| `alreadyRecorded` | Someone is marked absent today. **`false` does not mean unsaved** — a period where everyone attended records no absence at all. |
| `trackingRecorded` | The behavioural sheet has been saved for this period today. **Use this one** to show "تم الحفظ". |

### Render what the server sends

Every student arrives with all four values resolved. A student never saved
before comes back `participation: true, homework: true, quiz: null`.

**Do not apply your own defaults.** The server owns them so web and mobile
cannot drift apart about what an unsaved row looks like.

### Errors

| Code | Body `message` | When |
|---|---|---|
| `400` | `معرّف الحصة غير صالح` | `lectureId` is not a valid id |
| `403` | `هذه ليست حصتك` | Teacher is not the teacher of this lecture |
| `404` | `المحاضرة غير موجودة` | No such lecture |

---

## 2. Save the sheet

```
POST /daily-tracking/bulk
```

| | |
|---|---|
| Auth | Bearer token |
| Permission | `school.dailyTracking.create` |
| Teacher rule | Must be the teacher of this lecture, else `403` |

### Request

```json
{
  "lectureId": "6ab0000000000000000000bb",
  "date": "2026-09-29",
  "records": [
    { "studentId": "6ab000000000000000000001", "absent": false, "participation": true,  "homework": true,  "quiz": null  },
    { "studentId": "6ab000000000000000000002", "absent": true,  "participation": false, "homework": false, "quiz": null  },
    { "studentId": "6ab000000000000000000003", "absent": false, "participation": true,  "homework": false, "quiz": false }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `lectureId` | ObjectId | yes | |
| `date` | `YYYY-MM-DD` | yes | Any other format is `400` |
| `records` | array | yes | 1–200 entries, no duplicate `studentId` |
| `records[].studentId` | ObjectId | yes | Must belong to this lecture's class |
| `records[].absent` | boolean | yes | |
| `records[].participation` | boolean | no | Omitted = `true` |
| `records[].homework` | boolean | no | Omitted = `true` |
| `records[].quiz` | boolean \| null | no | Omitted = `null` |

Send **all** students on the sheet in one request, including unchanged ones.
The server diffs against what is stored.

### Response `200`

```json
{
  "status": true,
  "message": "تم حفظ سجل المتابعة",
  "data": {
    "lectureId": "6ab0000000000000000000bb",
    "date": "2026-09-29",
    "saved": 3,
    "attendance": { "created": 1, "lifted": 0, "failed": 0 }
  }
}
```

`attendance.created` — new absences recorded (each notifies the family).
`attendance.lifted` — absences removed because the teacher re-ticked attendance.
`attendance.failed` — absences that could not be written; **see below.**

### `failed > 0` is a partial success, not a failure

The behavioural rows are always saved. If a family notification fails, that
student's absence was not recorded but everything else was — the teacher's
work is never discarded over one failed push.

Show a warning, not an error, and do not clear the form:

> تم حفظ المتابعة، وتعذّر تسجيل غياب (١) من الطالبات. أعيدي المحاولة.

### Errors

| Code | Body `message` | When |
|---|---|---|
| `400` | `التاريخ يجب أن يكون بصيغة YYYY-MM-DD` | Bad date |
| `400` | `N من الطالبات لا ينتمين إلى فصل هذه الحصة` | A `studentId` outside the roster |
| `400` | `تكرر معرّف طالبة أكثر من مرة في الطلب` | Same student twice |
| `403` | `هذه ليست حصتك` | Not this teacher's lecture |
| `404` | `الحصة غير موجودة` | No such lecture |

```json
{ "status": false, "message": "هذه ليست حصتك", "statusCode": 403 }
```

---

## Business Logic Notes

### 1. Unticking attendance unticks and disables the other three

When the teacher unticks **الحضور** for a student:

- Untick `participation`, `homework`, `quiz` in the same action.
- **Disable** those three inputs while she is marked absent.
- Re-ticking attendance re-enables them, back to `true, true, null`.

A student who was not in the room did not participate and did not bring her
work. Leaving those ticked writes a pleasant fiction into the monthly report.

The server enforces this regardless of what you send — an absent student is
always stored `participation: false, homework: false, quiz: null`. Mirroring
it in the UI is so the teacher sees what will be saved, and saves three taps
per absent student.

### 2. `quiz` is tri-state — `null` is not `false`

| Value | Means | UI |
|---|---|---|
| `null` | No quiz was held | Unticked, the default |
| `true` | Sat it and passed | Ticked |
| `false` | Sat it and did **not** pass | Needs to be distinguishable from `null` |

`null` and `false` are different facts. Collapsing them reports failures on
days when no quiz existed.

A plain two-state checkbox cannot express this. Either use three states, or —
simpler — a checkbox that sends `true` when ticked and `null` when unticked,
and only offer `false` where the teacher explicitly marks a failed quiz.
**Never send `false` for "no quiz today".**

### 3. `homework` is not the graded assignment modules

This boolean means **"she brought the work and attempted it"** — an
observation the teacher makes in the room. It carries no score, never reaches
`gradesCriteria`, and does not affect any grade.

Nasaq already has two *graded* assignment systems, both unrelated to this:

| | How it is done | Marked by | Module |
|---|---|---|---|
| `ExamType.ASSIGNMENT` | Questions answered on screen | Automatic | `exams` |
| Projects | Files uploaded by the student | The teacher, by hand | `projects` |

Both carry marks and feed the term grade. This checkbox does neither.

It is also **not** derivable from them: the system knows who uploaded a file,
and cannot know who brought her notebook to the lesson. Never auto-tick it
from a submission — a student who submits late would show "لم تحلّ" on the
lesson day, which is correct, and her file arrives two days later.

**Label it `حلّت الواجب`, not `الواجب`,** with a caption:
`رصد يومي — لا يؤثر في الدرجات`. A teacher who sees "الواجب" alone will read
it as the graded assignment.

### 4. Nothing is saved until she presses save

No autosave. The sheet opens with three of four boxes ticked, so an autosave
would record thirty perfect students the moment the screen loads, and the
report could not tell that from real observation.

- One **حفظ المتابعة** button.
- Disable it while the request is in flight — a double tap sends two requests
  and shows two conflicting messages.
- Warn before leaving with unsaved changes. The sheet takes two minutes to
  fill and leaving loses all of it.

### 5. Saving twice is safe

The save is idempotent on `(student, lecture, date)`. Re-saving updates the
existing row; it never creates a second one. A teacher can correct a tick and
save again as often as she likes.

Absences are reconciled by difference — existing ones are left untouched, so
a family's excuse and the manager's review of it are never destroyed by a
re-save.

### 6. The date is the school's day, not the device's

Send the date the teacher is looking at, as `YYYY-MM-DD`. Do not send
`toISOString()` — the school is `Asia/Riyadh` (UTC+3), and between midnight
and 03:00 the device's UTC date is still yesterday, which files the sheet
under a day the report never looks at.

Format from the local date parts, the same way the timetable already does.

---

## Suggested UI

```
┌──────────────────────────────────────────────────────────┐
│  الرياضيات · ٢/أ · الحصة ٣        الأحد ٢٩ سبتمبر        │
├──────────────────────────────────────────────────────────┤
│                    حضور   مشاركة   حلّت    اختبار         │
│                                    الواجب                │
│  ١  سارة الأحمد     ☑       ☑       ☑       ☐            │
│  ٢  نورة العتيبي    ☐       ☐       ☐       ☐   ← معطّلة  │
│  ٣  ريم القحطاني    ☑       ☑       ☐       ☑            │
├──────────────────────────────────────────────────────────┤
│  ٢٨ من ٣٠ حاضرة                       [ حفظ المتابعة ]   │
└──────────────────────────────────────────────────────────┘
```

Thirty rows × four checkboxes re-renders slowly on school hardware — memoise
the row component and hold the state in the container.

---

## 3. Monthly report (Phase 2)

```
GET /daily-tracking/reports/summary?startDate=&endDate=&classId=&subjectOfferingId=
```

| | |
|---|---|
| Auth | Bearer token |
| Permission | `school.dailyTracking.read` |
| Manager / Owner | Any class |
| Teacher | Only a class she appears on the timetable for, else `403` |

| Param | Required | Notes |
|---|---|---|
| `startDate` | yes | `YYYY-MM-DD` |
| `endDate` | yes | `YYYY-MM-DD`, **inclusive** |
| `classId` | yes | Unscoped would return the whole school |
| `subjectOfferingId` | no | Omitted = all subjects together |

### Response `200`

```json
{
  "status": true,
  "message": "تم استرجاع تقرير المتابعة",
  "data": {
    "classId": "6ab0000000000000000000cc",
    "subjectOfferingId": null,
    "startDate": "2026-09-01",
    "endDate": "2026-09-30",
    "studentCount": 2,
    "note": "رصد سلوكي — لا يؤثر في الدرجات",
    "students": [
      {
        "studentId": "6ab000000000000000000001",
        "studentName": "سارة الأحمد",
        "totalLectures": 20,
        "presentCount": 18,
        "absentCount": 2,
        "participationCount": 16,
        "homeworkCount": 14,
        "participationRate": 88.9,
        "homeworkRate": 77.8,
        "quizzes": { "passed": 3, "failed": 1, "noQuiz": 16 }
      }
    ]
  }
}
```

### Reading the numbers

**Rates are out of `presentCount`, not `totalLectures`.** A student there 4
days of 20 who participated on all 4 is at **100%**, not 20% — dividing by
the whole range would report illness as disengagement.

**`participationRate` can be `null`.** That means she was present on no
tracked day. `null` is not `0` — show `—`, not a zero bar, or the report
starts a conversation about a student who was simply away.

**`quizzes.noQuiz`** counts periods with no quiz. `passed + failed + noQuiz`
equals `totalLectures`.

**Presence is joined from the attendance collection.** There is no `absent`
field on a tracking row, deliberately, so "was she here?" has one answer.

---

## Permissions

| Role | read | create | update | delete |
|---|---|---|---|---|
| Teacher | ✅ | ✅ | ✅ | ❌ |
| Owner / Supervisor | ✅ | ❌ | ✅ | ❌ |
| Manager | ✅ | ✅* | ✅ | ❌ |
| Student | ❌ | ❌ | ❌ | ❌ |

\* A manager's default is read+update. Recording is the teacher's job in her
own lecture; the school reads the record and may correct it.

Nobody gets `delete`. Saving is an upsert, so correcting a tick is an update —
deleting would erase an observation rather than fix it, and no endpoint does it.

### If you get `403 ليس لديك صلاحية للقيام بهذا الإجراء`

**Log out and log in again.** Permissions are baked into the JWT when the
token is issued, not read from the database per request, so a teacher signed
in before this release carries the old array until she signs in again.

A school can also switch the area off deliberately, on the permissions screen
under **سجل المتابعة**. If one teacher gets 403 and another does not, check
there before anything else.

---

## Out of scope

- **Monthly report** — deliberately not built yet. Two weeks of real data
  first, so its shape is not guessed.
- **Student-facing view** — not built. Whether a student sees "لم تُشارك
  اليوم" is a pedagogical decision, not a technical one.
- **Edit window** — nothing currently stops a teacher editing a record from
  last month. `recordedBy` holds only the last author, not a history.
