# Ministry Grading Template & Annual Register — Web & Mobile Handoff

For the web (React) and mobile (Flutter) developers. This file covers both.
**The backend is done and deployed** (backend `ec70b20`). Read
`grading-templates-overview.md` first for the idea. This file is the API.
All UI copy stays in formal Arabic.

**Nothing changes for schools on the flexible system,** except the quiz
column (§3), which becomes a mark for every school.

---

## 1. Which system is the school on?

`GET /schools/me/settings` → `settings.gradingSystem`:

| Value | Meaning |
|---|---|
| `"flexible"`, or missing | Today's system («معايير الدرجات»). Show everything as now |
| `"ministry"` | The ministry template. Hide «معايير الدرجات» and show the annual register |

Read it once at login or app start and keep it with the school settings.

**Changing it** (school settings screen, OWNER or SUPERVISOR only):
`PATCH /schools/me/settings` with `{ "gradingSystem": "ministry" }`.
Suggested label: «نظام الدرجات: مرن (معايير الدرجات) / نظام الوزارة (السجل السنوي)».

| Error | Message |
|---|---|
| 400 (marks already exist in the active year) | «لا يمكن تغيير نظام الدرجات بعد رصد درجات في العام الدراسي الحالي؛ يُغيَّر قبل بداية العام» |
| 403 (any other role) | «تغيير نظام الدرجات متاح للمالك ومدير المدرسة فقط» |

## 2. Subjects: the assessment type (ministry only)

Show these fields on the subject add and edit forms **only when the system is
`ministry`**, and hide them for activity subjects:

| Field | UI | Values |
|---|---|---|
| `assessmentType` | select «نوع التقويم» | `"continuous"` «تقويم مستمر (40 + 60)», `"final_exam"` «تقويم ختامي (40 + 20 + 40)», `null` «لا يدخل في السجل» |
| `passingGrade` | number «درجة النجاح» (optional) | 0–100. Empty (`null`) uses the school's default |

They are sent with the usual `POST /subjects` and `PATCH /subjects/:id`, and
come back on `GET /subjects`.

- **Optional, a different type for one grade.** For example, a subject
  continuous in the lower grades and with a final later:
  `PATCH /subject-offerings/:id` with `{ "assessmentType": "final_exam" }`.
  Send `null` to fall back to the subject's type.
- A subject without a type is **not in the register** and has no say in
  promotion. KG subjects can stay that way.

## 3. Daily tracking: the quiz becomes a mark (all schools)

**Read:** `GET /attendance/lecture/:id/sheet?date=YYYY-MM-DD`

```jsonc
{
  "data": {
    "quizMaxScore": 10,        // NEW: what this period's marks are out of; null = no quiz saved yet
    "registerLocked": false,   // NEW: true = annual register approved; show the sheet read only
    "students": [
      { "_id": "…", "name": "…", "absent": false, "participation": true, "homework": true,
        "quizScore": 8,        // NEW: number | null
        "quiz": true }         // LEGACY: older builds only; do not use
    ]
  }
}
```

**Save:** `POST /daily-tracking/bulk`

```jsonc
{
  "lectureId": "…", "date": "2026-10-12",
  "quizMaxScore": 10,                                 // NEW: required when any quizScore is a number
  "records": [
    { "studentId": "…", "absent": false, "participation": true, "homework": true, "quizScore": 8 },
    { "studentId": "…", "absent": false, "participation": true, "homework": false, "quizScore": null },
    { "studentId": "…", "absent": true }
  ]
}
```

- **New clients always send `quizScore`** on every record. Use `null` for no
  mark.
- **If the key is left out, the stored mark is kept.** Builds already in
  teachers' hands rely on this.
- **Marking a student absent clears her mark.** Disable her field.

| Error | Message |
|---|---|
| 400: a mark with no out-of | «حدّد الدرجة العظمى للاختبار» |
| 400: a mark above the out-of | «درجة الاختبار يجب أن تكون بين 0 والدرجة العظمى» |
| 409: register approved | «اعتُمد السجل السنوي لهذه المادة؛ لا يمكن تعديل المتابعة» |

**UI**
- Above the table, add a field «الدرجة العظمى للاختبار», prefilled from
  `quizMaxScore`, or empty.
- In the quiz column, put a **number field** per student instead of the
  tri-state toggle.
- An empty cell means no quiz. It is never 0.

```
حصة الرياضيات — الأحد 12 أكتوبر          الدرجة العظمى للاختبار: [10]
الطالبة     حاضرة   شاركت   الواجب   الاختبار
سارة          ✓       ✓       ✓       [ 8 ]
ريم           ✗       —       —       [ — ]   ← absent: disabled
```

**Report** (`GET /daily-tracking/reports/summary`): each student row has
`quizAverage`, the percentage of quiz marks earned (0–100), or `null` when
she sat none. Show it instead of the passed/failed counts. The `note` field
now depends on the school's system.

## 4. Exams and projects (ministry schools)

In a ministry school, «معايير الدرجات» is not needed. These changes apply:

- **Web, `TeacherExamAdd`:** `enabledExamTypes` is built from the criteria
  weights today. **In a ministry school no criteria exist, so every type
  would be disabled.** When `gradingSystem === "ministry"`:
  - enable `quiz`, `assignment` and `activity`;
  - enable `final` **only** if the subject's assessment type is
    `final_exam`;
  - hide the «لا يوجد توزيع درجات» warning.
- **New optional field `grade` (1–100)** on `POST /exams`. It is what the
  exam is out of. The default is 40 for a final and 10 otherwise.
  Suggested label: «الدرجة العظمى للاختبار». Not needed in flexible
  schools (it is ignored there).
- **Projects** also accept an optional `grade` (form field, default 10).
- **No limit on the number of quizzes.** Every one counts.
- Where each exam counts in the register:

  | Exam type | Register part |
  |---|---|
  | Quiz | Written assessments |
  | Assignment, activity, project | Tasks, inside the 40 |
  | Final | End-of-term exam |

| Error | Message |
|---|---|
| 400: final on a continuous subject | «هذه المادة تقويم مستمر ولا يوجد لها اختبار نهاية فترة» |
| 400: final on a subject with no type | «لم يُحدَّد نوع التقويم لهذه المادة؛ يحدده مالك المدرسة (مستمر أو ختامي)» |

## 5. The annual register API (ministry schools)

Every route returns 400 «السجل السنوي متاح للمدارس التي تعمل بنظام درجات
الوزارة» on a flexible school.

### `GET /grade-register/sheet?classId=&subjectOfferingId=`

Who can open it:
- the teacher of that subject in that class;
- the OWNER or SUPERVISOR;
- a MANAGER with `gradeRegister.read`.

```jsonc
{
  "data": {
    "classId": "…", "className": "م1/أ",
    "subjectOfferingId": "…", "subjectName": "العلوم",
    "term": { "_id": "…", "name": "الفترة الأولى" },
    "assessmentType": "final_exam",
    "maxScores": { "performance": 40, "written": 20, "final": 40 },   // final is 0 for continuous
    "passingGrade": 60,                  // null = the school's default
    "status": "draft",                   // "draft" | "approved"
    "approvedAt": null, "approvedByName": "",
    "writtenItems": [ { "_id": "…", "title": "ورقة عمل 1", "maxScore": 5 } ],
    "students": [
      {
        "studentId": "…", "name": "سارة",
        "performance": {                 // the 40
          "score": 25.75,                // null = no data yet
          "participationRate": 75, "homeworkRate": 50, "tasksRate": 70,   // percentages, each may be null
          "presentPeriods": 4
        },
        "written": {
          "score": 14.4, "rate": 72,     // null = nothing written yet
          "count": 3,                    // papers counted
          "marks": { "<writtenItemId>": 5 }   // her marks in the teacher's own items, for the input cells
        },
        "final": { "score": 36, "source": "electronic" },   // "manual" | "electronic" | null; the whole object is null for continuous
        "total": 76.15,                  // null while any part is missing
        "complete": true
      }
    ]
  }
}
```

**How it is worked out** (show it in a tooltip, or under «طريقة الحساب»):
- **40, performance and interaction:**
  - With tasks: 15 × participation rate + 15 × homework rate + 10 × tasks
    rate.
  - With no task all term: 20 + 20.
  - Rates count only **periods she attended**, so absences never lower
    them.
- **Written:** marks earned ÷ marks possible, across paper quizzes, electronic
  quizzes and the teacher's own items.
  - An electronic paper that closed unsat counts 0.
  - One still open is not counted yet.
- **Final:** a typed mark wins. Otherwise the electronic final's percentage
  × 40.

### `PUT /grade-register/sheet` — typed marks

Who can save: the teacher, OWNER, SUPERVISOR, or a MANAGER with
`gradeRegister.edit`. It returns the whole sheet, the same as GET.

```jsonc
{
  "classId": "…", "subjectOfferingId": "…",
  "finalMarks": [ { "studentId": "…", "score": 31 }, { "studentId": "…", "score": null } ],   // out of 40; null removes
  "writtenItems": [
    { "title": "ورقة عمل 1", "maxScore": 5, "marks": [ { "studentId": "…", "score": 4 } ] },  // new item
    { "_id": "…", "marks": [ { "studentId": "…", "score": 5 } ] },                             // edit marks
    { "_id": "…", "title": "بحث", "maxScore": 10 },                                            // rename or resize
    { "_id": "…", "remove": true }                                                            // delete
  ]
}
```

| Error | Message |
|---|---|
| 400: `finalMarks` on a continuous subject | «هذه المادة تقويم مستمر ولا يوجد لها اختبار نهاية فترة» |
| 400: mark out of range | «الدرجة يجب أن تكون بين 0 وN» |
| 400: student not in the class | «طالبة لا تنتمي إلى هذا الفصل» |
| 400: lowering an item's out-of below a recorded mark | «الدرجة العظمى أقل من درجة مرصودة في هذا البند» |
| 409: sheet approved | «السجل معتمد؛ يلزم إعادة فتحه للتعديل» |
| 403: not her class | «ليس لديك صلاحية على سجل هذه المادة في هذا الفصل» |

### `POST /grade-register/sheet/approve` and `POST /grade-register/sheet/reopen`

- **Body:** `{ "classId", "subjectOfferingId" }`.
- **Approve:** OWNER, SUPERVISOR, or a MANAGER with `gradeRegister.edit`.
  - It freezes the rows.
  - It locks that subject's daily tracking for the class (§3 returns 409).
  - **Promotion and the student read only approved registers.**
  - Refused with 400 while any student is incomplete:
    «لا يمكن الاعتماد: N من الطالبات درجاتهن غير مكتملة».
- **Reopen:** OWNER or SUPERVISOR. It unlocks everything.

### `GET /grade-register/class-report?classId=&termId=`

Admins only. Every registered subject's total, for one class. `termId` is
optional; the default is the current term. For printing.

```jsonc
{ "data": {
  "className": "م1/أ",
  "subjects": [ { "subjectOfferingId": "…", "subjectName": "العلوم", "assessmentType": "final_exam", "status": "approved" } ],
  "students": [ { "studentId": "…", "name": "سارة", "totals": { "<subjectOfferingId>": 76.15 } } ]
} }
```

### `GET /grade-register/me?termId=` (STUDENT)

```jsonc
{ "data": { "className": "م1/أ", "subjects": [
  { "subjectOfferingId": "…", "subjectName": "العلوم", "term": { "_id": "…", "name": "…" },
    "assessmentType": "final_exam", "maxScores": { "performance": 40, "written": 20, "final": 40 },
    "status": "approved",        // "pending" = not approved yet: all marks null; show «لم يُعتمد بعد»
    "performance": 25.75, "written": 14.4, "final": 36, "total": 76.15 }
] } }
```

## 6. Screens

| Who | Screen | Notes |
|---|---|---|
| Owner (web) | Settings: «نظام الدرجات» | §1 |
| Owner (web, mobile) | Subject form: «نوع التقويم» and «درجة النجاح» | §2, ministry only |
| Owner (web) | Hide «معايير الدرجات» from the menu in a ministry school | Its data is kept |
| Teacher (web, mobile) | Period sheet: the quiz mark column | §3, all schools |
| Teacher (web, mobile) | Exam form: the type rules and `grade` | §4 |
| Teacher (web; mobile later) | **«السجل السنوي»**: pick class and subject, see the table, type paper final marks and her own written items | §5. Columns show the max: «المهام والمشاركة (40)», «تحريري (20)», «نهاية الفترة (40)», «المجموع». Read only when `status` is `approved` |
| Admin (web) | The same register, plus «اعتماد السجل» and «إعادة فتح», and the class report for printing | §5 |
| Student (mobile, web) | «درجاتي» in a ministry school: use `GET /grade-register/me` | The old grades route has no criteria to read in a ministry school |
| Owner | Permissions screen: a new row «السجل السنوي» (`gradeRegister`): عرض / إضافة / تعديل | Edit = save marks and approve |

**Suggested order:**
1. §1 and §2 (settings and subjects).
2. §3 (quiz mark).
3. §4 (exam form).
4. The register on web (§5).
5. «درجاتي» and the register on mobile.

## 7. What does not change

- Flexible schools: everything, apart from the quiz mark in §3.
- Electronic exams and automatic marking, the one final per grade, saving
  answers as she goes, and the other exam safeguards.
- Curriculum distribution, subject offerings, the timetable, «مادة أساسية
  للترقية», and the yearly average across terms.
