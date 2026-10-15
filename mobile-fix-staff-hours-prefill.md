# Mobile fix: staff hours should start from the school's week

**For:** Azza (`nasaq_mobile`).
**Backend:** no change.
**File:** `lib/owner/presentation/screens/add_edit_staff_member_screen.dart`.
**Reference:** the web does this correctly in `nasaq-frontend/src/pages/StaffMembers/StaffMembers.jsx` (`schoolWeek`).

## The problem

The «مواهب المملكة» school works 06:45–13:10 on Sunday and Monday, 06:45–12:30 on Tuesday and Wednesday, and 06:45–11:50 on Thursday. There are two places where the app fills the week with something other than the school's hours.

### 1. Turning on «مواعيد خاصة بالموظف» fills 07:00–14:00

`_defaultWeek()` (around line 126) builds Sunday–Thursday as `07:00`–`14:00`, with Friday and Saturday off.

**What goes wrong:** the owner opens the guard, turns the switch on, changes Sunday's start to 06:15 and saves. The app sends all seven days, so Monday to Thursday are saved as 07:00–14:00. From then on:

- the guard is "late" if he arrives at 07:05 on Monday;
- leaving at 11:50 on a Thursday counts as 2 h 10 min of early leave.

The owner never touched those days.

### 2. Days missing from the server's list are shown as days off

`_buildFullWeek()` (around line 139) fills any day the server did not return with `isWorkingDay: false`.

**The backend rule:** a day **not** in the staff member's `workSchedule` follows the school's day (see `staff-own-hours-api.md`, «How it works»). It is not a day off.

**What goes wrong:** if a staff member's list holds only some days (for example only `saturday`, set from the API or a future screen), the edit screen shows Sunday to Thursday as days off. Saving then really turns them into days off.

## The fix

Load the school's week once when the screen opens, and use it in both places. The endpoint is already in the app: `schoolSettingsApi` = `GET /schools/me/settings` (see `school_settings_repository.dart`). The week is `settings.workSchedule`, a list of `{ day, isWorkingDay, startTime, endTime }`.

```dart
// When the screen opens (initState), next to the staff member's data:
List<StaffWorkDay> _schoolWeek = const [];

Future<void> _loadSchoolWeek() async {
  final res = await DioHelper.getData(url: schoolSettingsApi);
  res.fold((_) {}, (r) {
    final data = r.data is Map ? (r.data['data'] ?? r.data) : null;
    final settings = data is Map ? (data['settings'] ?? data) : null;
    final list = settings is Map ? settings['workSchedule'] : null;
    if (list is List) {
      setState(() => _schoolWeek = list
          .whereType<Map>()
          .map((e) => StaffWorkDay.fromJson(Map<String, dynamic>.from(e)))
          .toList());
    }
  });
}

/// The school's day, or a sensible default when the school has none set.
StaffWorkDay _schoolDay(String day) {
  final found = _schoolWeek.where((d) => d.day == day);
  if (found.isNotEmpty) return found.first;
  final isWorking = !['friday', 'saturday'].contains(day);
  return StaffWorkDay(
    day: day,
    isWorkingDay: isWorking,
    startTime: isWorking ? '07:00' : null,
    endTime: isWorking ? '14:00' : null,
  );
}
```

Then:

```dart
// 1. Switch turned on: start from the school's week.
List<StaffWorkDay> _defaultWeek() => _weekDays.map(_schoolDay).toList();

// 2. Days the server did not return: the school's day, not a day off.
List<StaffWorkDay> _buildFullWeek(List<StaffWorkDay> partial) {
  final map = {for (final d in partial) d.day: d};
  return _weekDays.map((d) => map[d] ?? _schoolDay(d)).toList();
}
```

- If the settings call fails, `_schoolDay` falls back to today's 07:00–14:00, so nothing gets worse.
- Show a small warning in that case, as the web does: «تعذر تحميل مواعيد المدرسة. تحقق من الجدول قبل حفظ المواعيد الخاصة.»
- If the staff member already has hours, the screen may open before the settings arrive. Build the week again once `_schoolWeek` loads, **as long as the owner has not edited anything yet** (`_scheduleTouched == false`).

## How to test

On the yamamah test school, not مواهب:

1. In school settings, give Thursday a different end time from the other days (for example 11:50).
2. Add a staff member and turn on «مواعيد خاصة بالموظف». Each day shows **the school's** times, including Thursday at 11:50, not 07:00–14:00.
3. Change only Sunday's start and save. Open the staff member again: Monday to Thursday still show the school's times.
4. Turn the switch off and save. Open again: the switch is off, and the response holds `"workSchedule": []`.
