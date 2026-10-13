# Staff working hours of their own (مواعيد خاصة بالموظف)

**Backend:** live since `44721ca`, 13 Oct 2026.
**Needed from:** web (the staff members page) and mobile (the add/edit staff member screen).
**Nothing else changes:** check-in, check-out, attendance lists, reports, leave and excuses keep the same endpoints and response shapes.

## Why

مواهب المملكة's guard starts at 06:30, half an hour before the school day. Every staff figure (lateness, early leave, working days, absences) was measured against the school's hours from school settings. So the guard read as on time when he came at 06:55, which is 25 minutes late for him.

A service staff member can now have hours of their own. Anyone without them keeps the school's hours, exactly as before.

## How it works

- A staff member's `workSchedule` is a list of days. It has the same shape as the school's `workSchedule` in school settings, without `periodsPerDay`.
- **A day in the list replaces the school's day of the same name.** Days not in the list follow the school.
- **An empty list (`[]`) means "follows the school's hours".** This is the default for everyone, including all existing staff.
- **School holidays (إجازات المدرسة) still apply to everyone,** even on a day in the staff member's own list.
- Old attendance records are not recalculated. A record keeps the lateness it was saved with.

Example: the school works Sun–Thu 07:00–14:00. The guard has:

| Day | His hours | Result |
|---|---|---|
| Sun–Thu | 06:30–13:30 | Late after 06:30, early leave before 13:30 |
| Saturday | 07:00–12:00 | A working day for him only, while the school is off |
| Friday | not listed | Follows the school (day off) |

## API

All on the existing `/staff-members` routes (OWNER, SUPERVISOR).

### Read: `GET /staff-members`

Every row now has `workSchedule`:

```json
{
  "id": "6a…",
  "fullName": "محمد السيد",
  "username": "guard01",
  "jobLabel": "حارس",
  "phoneNumber": "0501234567",
  "workSchedule": [
    { "day": "sunday",   "isWorkingDay": true, "startTime": "06:30", "endTime": "13:30" },
    { "day": "saturday", "isWorkingDay": true, "startTime": "07:00", "endTime": "12:00" }
  ],
  "hasEmail": false,
  "createdAt": "…"
}
```

`"workSchedule": []` means the person follows the school's hours.

The `POST` and `PATCH` responses return the same object.

### Create: `POST /staff-members`

The body may include `workSchedule`. If you leave it out, it defaults to `[]`.

### Update: `PATCH /staff-members/:id`

- Send `workSchedule` to replace the whole list.
- Send `"workSchedule": []` to go back to the school's hours.
- Leave the key out to keep the list as it is.

### Day object

| Field | Type | Notes |
|---|---|---|
| `day` | `sunday` … `saturday` | lowercase English, required |
| `isWorkingDay` | boolean | default `true` |
| `startTime` | `"HH:mm"` or `null` | 24-hour, school timezone |
| `endTime` | `"HH:mm"` or `null` | 24-hour, school timezone |

### Validation (400, Arabic message in `message`)

| Rule | Message |
|---|---|
| A day appears twice | لا يتكرر اليوم في مواعيد الموظف |
| A working day has one time and not the other | حدّد بداية الدوام ونهايته معًا في يوم العمل |
| `startTime` is not before `endTime` (there is no night shift) | بداية الدوام يجب أن تسبق نهايته |
| Bad day name or time format | class-validator message |
| More than 7 days | class-validator message |

- **A day off** (`isWorkingDay: false`) is saved with `startTime` and `endTime` set to `null`, whatever you send.
- **A working day with both times `null`** is allowed: it counts as a working day, but lateness is not measured that day. Prefer sending both times.

## What uses the new hours (backend, already done)

- **Check-in and check-out:** lateness, early leave, and whether «سبب التأخير» is required.
- **Owner/supervisor records:** manual attendance entries and edits to a record's times.
- **`GET /staff-attendance/absent?date=`:** a person appears only if that date is one of their working days.
- **`GET /staff-attendance/summary`:** each row's `workingDays` and `daysAbsent` use that person's week. The top-level `workingDays` stays the school's.
- **The automatic "you did not check in" notice:** sent after the person's own day ends.
- **Absence excuses:** which days can be explained, the pending days list, and «كان حاضرًا».

## Web (`nasaq-frontend`)

1. **`src/APIs/school/staffMembers.js`:** `clean()` drops every key it does not list, so `workSchedule` will never reach the server unless you add it. It is an array, so do not pass it through the `text()` trim. Pass it as is, and send `[]` when the owner turns the section off.
2. **`src/pages/StaffMembers/StaffMembers.jsx`:** add a section to the add/edit form:
   - A switch, **«مواعيد خاصة بالموظف»**:
     - **Off:** send `workSchedule: []`, and show the hint «يتبع مواعيد دوام المدرسة».
     - **On:** show seven rows, Sunday to Saturday. Each row has a «يوم عمل» checkbox, plus «بداية الدوام» and «نهاية الدوام» time pickers when it is checked.
   - **Prefill when switched on** from the school's week (`GET /schools/me/settings` → `workSchedule`), so the owner only changes what differs. The week editor in `src/pages/SchoolSettings/SchoolSettings.jsx` (`WEEK_DAYS`, `normalizeWorkSchedule`) can be reused.
   - **Send all seven days** when the switch is on. It is simpler than sending only the differences, and the result is the same.
   - **In the list,** show a small chip «مواعيد خاصة» on rows whose `workSchedule` is not empty, for example «٠٦:٣٠ – ١٣:٣٠».
3. **Check before saving:** both times on a working day, and the start before the end. Show the server's message if it refuses.

## Mobile (`nasaq_mobile`)

The owner manages staff from the app too, so the same form is needed there.

1. **`lib/owner/data/models/staff_member_model.dart`:** parse `workSchedule` (a list of `{day, isWorkingDay, startTime, endTime}`). If the field is missing, use an empty list, for older servers.
2. **`lib/owner/presentation/screens/add_edit_staff_member_screen.dart`:** add the same switch and seven-day editor as the web. Put `data['workSchedule']` in the payload:
   - **switch on:** the list of seven days;
   - **switch off:** `[]`;
   - **edit screen, switch never touched:** leave the key out.
3. **Reuse the school week UI.** `lib/owner/presentation/widgets/school_settings/school_working_days_section.dart` already edits the school's week. A trimmed copy without periods fits here.
4. **`staff_members_management_screen.dart`:** show the same «مواعيد خاصة» chip on staff with their own hours.

## UI copy (formal Arabic)

| Where | Text |
|---|---|
| Section title | مواعيد الدوام |
| Switch | مواعيد خاصة بالموظف |
| Hint, switch off | يتبع مواعيد دوام المدرسة |
| Hint, switch on | تُحسب مواعيد الحضور والتأخير والغياب لهذا الموظف وفق الجدول أدناه، وتسري عليه إجازات المدرسة الرسمية |
| Day checkbox | يوم عمل |
| Times | بداية الدوام / نهاية الدوام |
| Chip in the list | مواعيد خاصة |

## Test checklist

Test on the yamamah test school (`owner@yamamah.test`), not on مواهب.

1. Create a staff member with the switch off. `workSchedule` is `[]`, and nothing differs from before.
2. Turn the switch on and set Sunday to 06:30–13:30. Record a manual check-in at 06:45 from staff attendance. Lateness shows 15 minutes.
3. Mark Saturday as a working day for them. On a Saturday, they appear in «الغائبون» if they have not checked in, and the other staff do not.
4. Monthly report: their «أيام العمل» is higher than the others' by the number of Saturdays in the range.
5. Send end before start, or one time only. The server's Arabic message shows.
6. Turn the switch off and save. `workSchedule` returns `[]`.
