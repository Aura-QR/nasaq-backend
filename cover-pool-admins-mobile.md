# Cover (احتياط): Opening the Register, and Supervisors as Cover — Mobile Handoff

For the mobile (Flutter) developer. **Backend is done and deployed.** The web
side of part A is done too (frontend `3ae48c9`) and works as a reference.
Keep all UI copy in formal Arabic.

There are two parts. **Part A is a bug that affects teachers today**, so do it
first.

> **Update, 5 Oct 2026:** only **administrative assistants (MANAGER)** join
> the cover pool. **SUPERVISOR is the principal (مدير المدرسة) and is never a
> substitute** — the backend no longer offers or accepts them. Labels:
> `MANAGER` → «إداري/ة», `SUPERVISOR` (old rows only) → «مدير المدرسة». The
> picker heading is «المساعدون الإداريون».

---

## Part A. A teacher covering a period cannot open its register

**Today:** a teacher assigned as substitute sees the period on «يومي»
(`teacher_duty_screen.dart`, the cover slots ~line 773), but there is no way
to take its attendance and daily tracking. The register
(`TeacherDailyTrackingScreen` with `TeacherDailyTrackingCubit`) finds the
lecture with `scheduleRepository.fetchLectures()`. That list holds only her
**own** timetable, so a covered lecture is never found.

**Backend:** the substitute may now read the sheet
(`GET /attendance/lecture/:lectureId/sheet?date=`) and save
(`POST /daily-tracking/bulk`) **for the covered period, on that date only**.
On any other day she gets `403 «هذه ليست حصتك»`.

### Tasks

1. **Button on the cover slot.** On each `kind == "cover"` slot in
   `teacher_duty_screen.dart`, add **«رصد الحضور والمتابعة»**. It opens
   `Routes.teacherDailyTracking` with
   `{ 'lectureId': slot.lectureId, 'date': day.date }`.
2. **Let the cubit accept a covered lecture.** In
   `teacher_daily_tracking_cubit.dart` `init()`, also call
   `GET /duty/my-day?date=<date>` and add its `kind == "cover"` slots to the
   lecture list. Label them
   **«{subject} · {class} · الحصة {slot} · احتياط عن {coveringFor}»**.
   If `initialLectureId` is one of them, select it. **Do not** fall back to
   the first own lecture, which is what happens today.
3. When the user changes the date, reload the cover slots. A cover period
   exists only on its own date.

`my-day` cover slot:

```json
{ "kind": "cover", "lectureId": "…", "slot": 3, "className": "٢/أ",
  "roomNumber": "12", "subjectName": "الرياضيات", "coveringFor": "أ. أروى",
  "substitutionId": "…" }
```

---

## Part B. Supervisors and managers can be assigned as cover

The school is short of free teachers, so an absent teacher's period can now be
given to a **MANAGER** (administrative assistant) account. The **OWNER**,
the **principal (SUPERVISOR)** and **STAFF** (guards) never can.

- **Order:** free teachers come first (specialists at the top), then
  administrative assistants in name order.
- **Availability:** an administrator is not offered if she has an approved
  staff leave that day. Once any administrator has checked in today, only
  those who checked in are offered.
- **Notification:** she receives `cover_assigned` / `cover_removed`, with the
  title «لديك حصة احتياط».
- **Recording:** she can take attendance and daily tracking for that period
  on that day.

### API changes (backwards compatible)

`GET /duty/coverage`, each suggestion (`SubstituteSuggestion`, ~line 38 of
`duty_repository.dart`) has two new fields:

```json
{ "teacherId": "…", "name": "أ. نورة", "specialization": null,
  "sameSubject": false,
  "type": "Admin",          // NEW: "Teacher" | "Admin"
  "role": "MANAGER" }       // NEW: "TEACHER" | "MANAGER"
```

- `teacherId` may be an **Admin id**. Post it back unchanged as
  `substituteTeacherId` to `POST /duty/substitutions`. **That request does
  not change.**
- `covered[]` entries (`CoverEntry`, ~line 61) have `substituteType` and
  `substituteRole`.
- `GET /duty/cover-report` rows (`CoverReportRow`, ~line 408) have `type` and
  `role`. For an administrator, `neededCover`, `approvedLeaves` and
  `daysPresent` are always `0`.
- `GET /duty/my-day` works for a MANAGER login. All of its slots
  are `kind: "cover"`.

### Tasks

1. **Models:** add `type` and `role` to `SubstituteSuggestion` and
   `CoverReportRow`, and `substituteType` and `substituteRole` to
   `CoverEntry`. All are nullable, and missing means Teacher.
2. **Picker** (`owner/presentation/screens/duty_screen.dart`, ~line 681):
   - Show teachers first. Then a heading **«المساعدون الإداريون»** with the
     `type == "Admin"` suggestions.
   - For an administrator, show the role in place of the specialization:
     `MANAGER` → **«إداري/ة»** (and `SUPERVISOR` → «مدير المدرسة» on old rows).
   - In the covered card (~line 600), add the same role label next to the
     substitute's name.
3. **Cover report screen:** add the role label for admin rows, and show
   «—» in place of their three zero columns.
4. **«حصص الاحتياط» screen for MANAGER logins** (not the principal or the
   owner):
   - **Data:** `GET /duty/my-day?date=`, with a date picker defaulting to
     today.
   - **Each card:** «الحصة {slot} · {className}», the subject and room, and
     «بدلًا من {coveringFor}».
   - **Button:** «رصد الحضور والمتابعة» opens the same register as Part A
     with `{lectureId, date}`. For an admin, `fetchLectures()` has nothing
     of hers, so the list is only her cover slots from Part A task 2. Make
     sure the register screen is reachable from the owner/admin navigation,
     not only from the teacher shell.
   - **Empty state:** «لا توجد حصص احتياط مكلّف بها في هذا اليوم».
   - **Entry point:** add it to `owner/presentation/models/sidebar_config.dart`
     beside «الاحتياطي والمناوبة» (~line 237), shown only when the role is
     MANAGER. Not `PermissionHelper.can('read', 'duty')`,
     because the owner has that too and is never a substitute.
5. **Notification bell** (`core/widgets/notification_bell.dart`, owner map
   ~line 47): `cover_assigned` and `cover_removed` go to `Routes.ownerDuty`
   (the board). Only the substitute receives these, so send them to the new
   «حصص الاحتياط» screen.

---

## How to test (QA school)

**Part A**

1. As the owner, assign a free teacher to cover an absent teacher's period
   today.
2. Log in as the substitute. «يومي» shows the cover slot with «رصد الحضور
   والمتابعة».
3. Press it. The register opens on that exact period, labelled «احتياط عن
   …». Save, and it succeeds.
4. Switch the date to tomorrow. The period disappears from the list.

**Part B**

1. On the cover board, the assistant appears after every free teacher, with
   «إداري/ة».
2. Assign her. Log in as her. The notification opens «حصص الاحتياط», and the
   period is there.
3. Open the register from it. Attendance and daily tracking both save.
4. A guard or the owner never appears in the picker.
