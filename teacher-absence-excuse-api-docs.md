# Teacher Absence Excuses — API Notes

Handoff notes for the Web (React) and Mobile (Flutter) developers.

A teacher who arrives late can already explain herself and the school rules
on it. A teacher who **missed a whole day** could not — the absence report
showed a name and nothing else, so the school phoned to ask, or never asked.

This gives that day the same conversation. It mirrors the student absence
excuse and the teacher lateness flow on purpose: same shapes, same rules.

**Backend is done and deployed.** Nothing here is pending on our side.

| # | Endpoint | Who |
|---|---|---|
| 1 | `GET /teacher-attendance/me/absence-excuse/pending` | Teacher |
| 2 | `POST /teacher-attendance/me/absence-excuse/attachment` | Teacher |
| 3 | `POST /teacher-attendance/me/absence-excuse` | Teacher |
| 4 | `GET /teacher-attendance/absence-excuses` | School |
| 5 | `PATCH /teacher-attendance/absence-excuses/:id/review` | School |

## Who builds what

Same API for both of you. The screens differ:

| | Build |
|---|---|
| **Mobile (Flutter)** | The teacher's side (1–3) **and** the school's review queue (4–5) |
| **Web (React)** | The school's review queue (4–5) first; the teacher's side if teachers use the web portal |

Nothing needs configuring before you start — no new permission, no
migration, no settings screen. Anyone who can already see teacher
attendance can review excuses today.

---

## The five things most likely to trip you up

Read these before writing anything. Each one has cost someone an afternoon
in a previous feature.

### 1. An excused absence is still an absence

`GET /teacher-attendance/summary` gained two fields. **`daysAbsent` itself
does not move when an excuse is accepted.**

```json
{ "daysAbsent": 3, "daysAbsentExcused": 2, "daysAbsentUnexcused": 1 }
```

✅ Render: **"3 غياب · منها 2 بعذر"**
❌ Never: **"1 غياب"**

The school asked to *receive* the explanation, not for the number to
change. A report that quietly edits an attendance figure is one nobody can
audit later. Guaranteed: `excused + unexcused === daysAbsent`, and
`excused` can never exceed `daysAbsent`.

### 2. Upload the file, then submit — two calls, on purpose

`POST .../attachment` returns a path. You send that path in `POST
.../absence-excuse`.

It is split so a teacher on a slow connection does not lose her typed
reason when a photo fails. **If the upload fails, let her submit without
it.** The reason is the part that matters; the medical note is a bonus.

Do not block the submit button on a successful upload.

### 3. Written once — `409` is not a failure to retry

There is a unique index on `(teacher, date)`. A second excuse for the same
day returns:

```json
{ "status": false, "message": "تم إرسال عذر عن هذا اليوم بالفعل", "statusCode": 409 }
```

That means **the day is done**, not that something went wrong. Refresh the
pending list and it will have disappeared. Do not show a red error or offer
a retry.

The same applies to review: an excuse already accepted or rejected cannot
be ruled on twice.

### 4. No new permission — but log out and back in if you see 403

The school side is guarded by `school.teacherAttendance.read` / `.update`,
which owners, managers and supervisors already hold. **Nothing has to be
granted.**

If you do hit a `403` while testing, it is the usual cause: permissions
live in the JWT, so an account signed in before the release carries the old
array. Log out, log back in.

### 5. It is not a leave request — three flows, don't merge them

| Situation | Flow | Endpoint |
|---|---|---|
| Came in late | عذر تأخير | `me/late-reason` |
| Missed a whole day | عذر غياب | `me/absence-excuse` ← **new** |
| Leaving early today | استئذان | `duty` leave request |

Submitting an excuse for a **future** day is refused — that is استئذان,
which already has its own approval and its own cover screen.

The server routes a teacher to the right flow when she picks wrong, via the
`400` messages in section 3 below. **Pass those messages through verbatim**
rather than writing your own — they are what tell her where to go.

---

## 1. Which days am I being asked about?

```
GET /teacher-attendance/me/absence-excuse/pending?days=14
```

| | |
|---|---|
| Role | `TEACHER` only |
| `days` | Optional, 1–60, default **14** |

Fourteen days and not just today: a teacher off sick for three days answers
once, when she is back, and the other two days have to still be there.

**Days off and school holidays never appear** — the server filters them, so
nobody is asked to explain a Friday.

### Response `200`

```json
{
  "status": true,
  "message": "أيام غياب بلا عذر",
  "data": [
    { "date": "2026-09-29" },
    { "date": "2026-09-28" }
  ]
}
```

Newest first. An empty array means nothing to explain — show a calm empty
state, not an error.

---

## 2. Attach a medical note (optional)

```
POST /teacher-attendance/me/absence-excuse/attachment
Content-Type: multipart/form-data
```

Field name: `file`. PDF or image (jpg, png, heic, webp). Max **10 MB**.

### Response `200`

```json
{
  "status": true,
  "message": "تم رفع المرفق",
  "data": { "attachment": "/uploads/absence-excuses/1759-ab12cd34.jpg" }
}
```

Keep that `attachment` string and send it with step 3.

### Why this is a separate call

So a teacher on a slow connection does not lose her typed reason when the
photo fails. **Let her submit without the file if the upload fails** — the
reason is the part that matters.

### Errors

| Code | When |
|---|---|
| `400` | No file sent, or not a PDF/image |
| `413` | Over 10 MB |

---

## 3. Submit the excuse

```
POST /teacher-attendance/me/absence-excuse
```

```json
{
  "date": "2026-09-29",
  "reason": "وعكة صحية",
  "attachment": "/uploads/absence-excuses/1759-ab12cd34.jpg"
}
```

| Field | Required | Notes |
|---|---|---|
| `date` | yes | `YYYY-MM-DD`, must be a past or present working day |
| `reason` | yes | Max 1000 chars, trimmed server-side |
| `attachment` | no | The path from step 2 |

### Response `200`

```json
{
  "status": true,
  "message": "تم إرسال عذر الغياب إلى إدارة المدرسة",
  "data": { "id": "...", "date": "2026-09-29", "status": "pending" }
}
```

### Errors — each one means something different, show the message

| Code | `message` | What happened |
|---|---|---|
| `400` | `هذا اليوم ليس يوم عمل` | A day off or a holiday |
| `400` | `لديك سجل حضور في هذا اليوم — عذر التأخير هو المناسب هنا` | She checked in; send her to the lateness flow |
| `400` | `لا يمكن تقديم عذر عن يوم لم يأتِ بعد — استخدم طلب الاستئذان` | Future day |
| `409` | `تم إرسال عذر عن هذا اليوم بالفعل` | Already explained |

```json
{ "status": false, "message": "تم إرسال عذر عن هذا اليوم بالفعل", "statusCode": 409 }
```

**The `409` is not a failure to retry.** It means the day is done — refresh
the pending list and it will have gone.

---

## 4. The school's queue

```
GET /teacher-attendance/absence-excuses?status=pending
```

| | |
|---|---|
| Permission | `school.teacherAttendance.read` |
| Roles | Owner, Supervisor, Manager |

| Param | Default | Values |
|---|---|---|
| `status` | `pending` | `pending` · `accepted` · `rejected` |
| `from` / `to` | — | `YYYY-MM-DD` |
| `teacherId` | — | ObjectId |

### Response `200`

```json
{
  "status": true,
  "data": [
    {
      "id": "...",
      "teacherId": "...",
      "teacherName": "أ. سارة",
      "date": "2026-09-29",
      "reason": "وعكة صحية",
      "attachment": "/uploads/absence-excuses/1759-ab12.jpg",
      "status": "pending",
      "submittedAt": "2026-09-30T06:12:00.000Z",
      "reviewedByName": "",
      "reviewedAt": null,
      "reviewNote": ""
    }
  ]
}
```

Sorted newest first. `attachment` is `null` when none was sent — render a
link only when it is present.

---

## 5. Accept or refuse

```
PATCH /teacher-attendance/absence-excuses/:id/review
```

```json
{ "verdict": "rejected", "note": "لم يُرفق تقرير طبي" }
```

| Field | Required | |
|---|---|---|
| `verdict` | yes | `accepted` or `rejected` |
| `note` | **on rejection** | Max 1000 chars |

**A rejection with no note is `400`.** Make the field required in the UI
when "refuse" is selected — a refusal a teacher cannot answer is the one
thing this must not produce.

### Errors

| Code | `message` |
|---|---|
| `400` | `اذكر سبب رفض العذر` |
| `400` | `معرّف العذر غير صالح` |
| `404` | `العذر غير موجود` |
| `409` | `تمت مراجعة هذا العذر بالفعل` |

The teacher is notified either way.

---

## The monthly summary

```
GET /teacher-attendance/summary?dateFrom=...&dateTo=...
```

Unchanged except for two fields per teacher:

```json
{
  "teacherName": "أ. سارة",
  "workingDays": 22,
  "daysAbsent": 3,
  "daysAbsentExcused": 2,
  "daysAbsentUnexcused": 1
}
```

See point 1 above for how to render this. If reading excuses fails on the
server, the report still returns — `daysAbsentExcused` is simply `0`, never
a missing field.

---

## Notifications

| Type | Goes to | When |
|---|---|---|
| `teacher_absence_excuse_submitted` | Owner, managers, supervisors | She explains |
| `teacher_absence_excuse_reviewed` | The teacher | They rule |

Both carry `excuseId`, `date` and `status` in `data`.

Route the bell on the **type**. These are deliberately distinct from the
student `absence_excuse_submitted` / `absence_excuse_reviewed` types: an
admin tapping a teacher's excuse must not land on the families' queue, and
a teacher tapping hers must not land on a list she cannot read.

---

## Suggested UI

### Teacher

A card on her attendance screen when the pending list is not empty:

```
┌────────────────────────────────────────┐
│  لديك يومان بلا عذر                    │
│                                        │
│  الثلاثاء ٢٩ سبتمبر        [ وضّح ]    │
│  الإثنين ٢٨ سبتمبر         [ وضّح ]    │
└────────────────────────────────────────┘
```

Tapping «وضّح» opens a sheet with the reason field and an optional attach
button. Keep the typed reason if the upload fails.

### School

Beside the existing lateness queue, with the same shape. Show the
attachment as a thumbnail or a link, and make the note field appear and
become required the moment "refuse" is chosen.

---

## Out of scope

- **Editing an excuse** — written once by design. If a school needs a
  correction path, that is a decision to make, not an oversight.
- **Bulk review** — one at a time; each needs its own note.
- **Excuses affecting payroll** — nothing here touches a salary figure.
- **Staff (non-teaching) absence excuses** — `staff-attendance` is a
  separate module and was not changed.

---

## Questions

Ask in the team channel. If something here does not match what the API
returns, the API is right and this file is wrong — say so and it gets fixed.
