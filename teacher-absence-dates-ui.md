# Attendance reports: show which days were absent (teachers and staff)

**For:** Azza (mobile). **Web is done** (`aefd190` teachers, `c28bc57` staff); copy its behaviour.
**Backend:** live for both `GET /teacher-attendance/summary` and `GET /staff-attendance/summary`. Nothing else changes.

## Why

The report shows «أيام الغياب: 3» but not which three days. The school has to open «سجل الحضور اليومي» and check every date by hand.

## API

`GET /teacher-attendance/summary?dateFrom=&dateTo=&teacherId=`: every row now has `absentDates`:

```json
"absentDates": [
  { "date": "2026-10-05", "excused": false },
  { "date": "2026-10-12", "excused": true }
]
```

- **Which days:** the school days in the range, or the teacher's own work days if she has custom days, with no check-in record. Holidays and days off are never listed.
- **`excused: true`:** the school accepted an absence excuse for that day.
- **Length:** always equals `daysAbsent`.

## UI

### Web: `/school/teacher-attendance`, tab «تقرير الحضور»
- Make the number in the «أيام الغياب» column clickable, when it is above 0.
- Clicking opens a small dialog titled «أيام غياب: <name>». List the dates newest first, in Arabic: weekday plus date, e.g. «الأحد ٥ أكتوبر ٢٠٢٦».
- Next to each date show a chip: «بعذر» (green) or «بدون عذر» (red).
- Optional: each date links to «سجل الحضور اليومي» filtered to that day.

### Mobile: the owner's teacher attendance report
- The same: tapping the absent count opens a bottom sheet with the dates and the chip.

## Formal Arabic copy

| Where | Text |
|---|---|
| Dialog title | أيام غياب: {الاسم} |
| Chips | بعذر / بدون عذر |
| Empty state | لا توجد أيام غياب في هذه الفترة |

## Staff report (same thing)

`GET /staff-attendance/summary` rows carry the same `absentDates`, using each person's own working hours when set. On mobile, the owner's staff attendance report: tapping the absence figure opens the same bottom sheet.
