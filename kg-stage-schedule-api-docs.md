# Stage-Specific School Days — API Notes

Handoff notes for the Web (React) and Mobile (Flutter) developers.

A kindergarten does not run a shorter primary day. It runs **twelve to
fourteen periods of about thirty minutes** — a morning meeting, a snack,
play — where a primary runs eight of forty-five. Until now the number of
periods was one setting for the whole school, so مواهب المملكة created its
three KG grade levels and could not build a timetable for them at all.

**Backend is done and deployed.** Nothing here is pending on our side.

## What changed, in one line

A **stage** can now carry its own school day. Everything else is unchanged.

| | Before | Now |
|---|---|---|
| Periods per day | One number, whole school | Per stage, falling back to the school |
| Max period number | 10 | **20** |
| Timetable grid | Same length for every class | Each class gets its own stage's day |

## The five things most likely to trip you up

1. **`periodsPerDay` is `null` on almost every stage.** `null` means "follow
   the school" — it is not missing data. Do not render `0`.
2. **A period number can now be 14.** Any UI assuming ≤10 columns, a
   `slot` dropdown of 1–10, or a fixed-width grid will clip.
3. **Two classes on one screen can have different day lengths.** Read the
   length per class, never once for the page.
4. **Thursday is scaled, not copied.** A 6-of-8 short day becomes 10 for a
   14-period stage, not 6.
5. **Nothing changes until a stage is given a number.** Deploying this
   moved no existing school.

---

## 1. Read the stages

```
GET /stages
```

| | |
|---|---|
| Auth | Bearer token |
| Access | Any signed-in school user |

### Response `200`

```json
{
  "status": true,
  "data": [
    {
      "_id": "6a7cf15824073b40534ee6f2",
      "name": "روضة",
      "order": 1,
      "periodsPerDay": 14,
      "startTime": "07:00",
      "endTime": "11:30",
      "periodMinutes": 30
    },
    {
      "_id": "6a8ab8aa6b48087f66b1d39c",
      "name": "المرحلة الابتدائية",
      "order": 1,
      "periodsPerDay": null,
      "startTime": null,
      "endTime": null,
      "periodMinutes": null
    }
  ]
}
```

### The four new fields

| Field | Type | `null` means |
|---|---|---|
| `periodsPerDay` | `number \| null` | Use `school.settings.periodsPerDay` |
| `startTime` | `"HH:mm" \| null` | Use the school's day start |
| `endTime` | `"HH:mm" \| null` | Use the school's day end |
| `periodMinutes` | `number \| null` | Not recorded |

**All four are `null` on every stage that existed before this release.** That
is the normal state, not missing data. Show "يتبع إعداد المدرسة" rather than
a zero or a blank.

---

## 2. Set a stage's day

```
PATCH /stages/:id
```

| | |
|---|---|
| Auth | Bearer token |
| Permission | `school.academicStructure.update` |
| Roles | Owner, Supervisor, Manager |

This is the **existing** stage endpoint. It already accepted `name` and
`order`; it now also accepts the four fields. Nothing about the route,
its guards or its other fields changed.

### Request — send only what you are changing

```json
{ "periodsPerDay": 14, "periodMinutes": 30, "startTime": "07:00", "endTime": "11:30" }
```

### Clearing a value

Send `null` explicitly. The stage goes back to following the school.

```json
{ "periodsPerDay": null }
```

Omitting the field leaves it as it was. **Omitted ≠ null** here.

### Validation

| Field | Rule | Error |
|---|---|---|
| `periodsPerDay` | integer 1–20, or null | `400` |
| `periodMinutes` | integer 5–120, or null | `400` |
| `startTime` / `endTime` | `HH:mm` 24-hour, or null | `400` with an Arabic message |

```json
{ "status": false, "message": "startTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة", "statusCode": 400 }
```

---

## 3. Timetable endpoints — same routes, different numbers

```
GET  /lectures/feasibility?termId=...&classIds=...
POST /lectures/generate
```

Neither route, its parameters, nor its response shape changed. What changed
is that **each class is now measured against its own stage's day**.

### `classPlans` is per class

```json
{
  "classes": [ /* the grid */ ],
  "classPlans": [
    { "classId": "...", "name": "تمهيدي 1", "demand": 70, "capacity": 66, "free": -4, "ok": false },
    { "classId": "...", "name": "الصف الأول/أ", "demand": 38, "capacity": 38, "free": 0, "ok": true }
  ],
  "problems": []
}
```

`capacity` is **that class's** week, not the school's. A KG class and a
primary class in the same response will legitimately show different numbers.
Do not compute a single "slots per week" for the page and reuse it.

### The grid has a different number of cells per class

```json
"classes": [
  {
    "classId": "...", "className": "تمهيدي 1",
    "days": [ { "dayOfWeek": "sunday", "slots": [ /* 14 entries */ ] } ]
  },
  {
    "classId": "...", "className": "الصف الأول/أ",
    "days": [ { "dayOfWeek": "sunday", "slots": [ /* 8 entries */ ] } ]
  }
]
```

**Render `slots.length` per class per day.** A fixed 8-column table hides six
real KG periods; a fixed 14-column table invents six primary ones that do not
exist. The array is already the right length — trust it and map over it.

---

## 4. Creating a lecture

```
POST /lectures
```

`slot` now accepts **1–20** instead of 1–10. Nothing else changed.

If you build a slot picker, its length must come from the class's stage, not
from a constant. A primary class offering period 12 will be rejected by the
generator's own capacity check even though the DTO allows it.

---

## Business Logic Notes

### 1. How a day's length is decided

Three levels, most specific wins:

```
that weekday's own override  →  the stage  →  the school
```

For مواهب المملكة today:

| | Sun–Wed | Thursday |
|---|---|---|
| School setting | 8 | 6 |
| Primary (`periodsPerDay: null`) | 8 | 6 |
| KG (`periodsPerDay: 14`) | 14 | **10** |

### 2. The short day is scaled, not copied

Thursday is 6 of 8 — **three quarters of a day**. Three quarters of a
fourteen-period KG day is 10.5, floored to **10**.

Applying the raw 6 would give the kindergarten a Thursday shorter than its
own morning schedule allows. The 6 means "three quarters of a day", not "six
absolute periods".

Guaranteed: never above the stage's own length, never below 1.

### 3. `periodMinutes` is for display only

It records that a KG period is 30 minutes and a primary period is 45. It is
**not** used for collision detection.

A lecture still carries a **slot number**, not a clock time. So period 3 in
KG and period 3 in primary are treated as the same moment even though one
starts at 08:00 and the other at 08:30.

> **Tell the school:** keep KG teachers off primary classes until a lecture
> knows its own time. A teacher assigned to both stages can be double-booked
> without the system objecting.

This is a known limitation, not a bug to report.

### 4. Nothing moved for existing schools

Every stage ships with all four fields `null`, and `null` means "follow the
school". No migration ran and no school's timetable changed. A school only
sees a difference after somebody sets a number on a stage.

---

## Suggested UI

### Stage settings

```
┌──────────────────────────────────────────────┐
│  روضة                                        │
│                                              │
│  حصص اليوم        [ 14 ]                     │
│  اتركه فارغًا ليتبع إعداد المدرسة (٨)         │
│                                              │
│  طول الحصة        [ 30 ] دقيقة               │
│  بداية اليوم      [ 07:00 ]                  │
│  نهاية اليوم      [ 11:30 ]                  │
└──────────────────────────────────────────────┘
```

Show the school's number as the placeholder so an empty field reads as a
choice rather than a gap.

### Timetable

Take the column count from the class being rendered. If the screen shows
several classes at once, each needs its own column count — a shared header
row across a KG class and a primary class will be wrong for one of them.

---

## Out of scope

- **Activity subjects** — «لقاء صباحي», «وجبة», «لعب» are currently ordinary
  Subject records, which is how the school already entered them. They still
  appear in preparation and grading screens. A dedicated activity type is
  Phase 2, if the school asks for it.
- **Real clock times on a lecture** — see note 3. Until then, cross-stage
  teacher collisions are not detected.
- **Per-class days** — the day belongs to the stage. Two classes in the same
  stage always run the same day.

---

## Questions

Ask in the team channel. If something here does not match what the API
returns, the API is right and this file is wrong — say so and it gets fixed.
