# Mobile: «إحصائيات الطلاب» in the admin panel

**For:** Azza (`nasaq_mobile`, the owner/manager panel under `lib/owner/`).
**Backend:** live. **Web:** done (`nasaqedu.org/users/students/statistics`). Open it to see the exact behaviour, and match it.
**Why:** the school prepares statistical reports of its students: how many per stage, grade and class, how many boys and girls, Saudi and non-Saudi, and any combination of these. It also follows the residency documents of non-Saudi students, which the ministry reviews.

## Where

- Sidebar (`sidebar_config.dart`), section `individuals`, right after «إدارة الطلاب»: **«إحصائيات الطلاب»**, shown when `PermissionHelper.can('read', 'students')`.
- The server allows **OWNER, SUPERVISOR, MANAGER (with read-students) and SUPER_ADMIN** only. A teacher or student gets 403, so never show it outside the owner panel.

## The endpoint

```
GET /students/statistics?stageId=&gradeLevelId=&classId=&gender=&nationality=
```

All parameters are optional. **Do not send empty ones** (an empty value is ignored anyway).

| Param | Values |
|---|---|
| `stageId`, `gradeLevelId`, `classId` | ids |
| `gender` | `male` · `female` |
| `nationality` | `saudi` · `non_saudi` · `unspecified` · an ISO code such as `EG` |

- It counts **the active academic year only**, and only active students in this year's classes.
- **Every breakdown is computed after the filters.** So one call fills the whole screen for whatever the user picked. Example: `nationality=non_saudi&gender=female` → the cards and all tables show non-Saudi girls only.
- Stages, grades and classes with no matching students are still listed, with zeros.
- Nationality is read from the code or, if missing, from the saved text. A student with no nationality is **«غير محدد»**, counted as neither Saudi nor non-Saudi.

### Response (`data`)

Every counts block has these fields:
```json
{ "total": 262, "male": 85, "female": 177, "saudi": 242, "nonSaudi": 15, "unspecifiedNationality": 5,
  "maleSaudi": 82, "maleNonSaudi": 1, "femaleSaudi": 160, "femaleNonSaudi": 14 }
```

```json
{
  "school": { "name": "مدارس مواهب المملكة الأهلية" },
  "academicYear": { "_id": "…", "name": "2027-2028" },
  "filters": { "gender": "female" },
  "total": { …counts },
  "byStage":      [{ "stageId", "name", "classCount", …counts }],
  "byGradeLevel": [{ "gradeLevelId", "name", "stageId", "stageName", "classCount", …counts }],
  "byClass":      [{ "classId", "name", "classGender", "gradeLevelId", "gradeLevelName", "stageId", "stageName", …counts }],
  "byNationality":[{ "code": "SA", "label": "سعودي", "isSaudi": true, "total", "male", "female" },
                   { "code": null, "label": "غير محدد", … }],
  "unspecifiedStudents": [{ "_id", "name", "classId", "className" }],
  "residency": {
    "nonSaudi": 15, "valid": 9,
    "missing":      [{ "_id", "name", "classId", "className" }],
    "pending":      [ … ],
    "expired":      [{ …, "expiryDate" }],
    "expiringSoon": [{ …, "expiryDate" }]
  }
}
```

- `byStage` and `byGradeLevel` are in the school's order; `byClass` comes by name. **Sort classes by their grade's position in `byGradeLevel`, then by name**, as the web does.
- `byNationality` is largest first, with «غير محدد» last.
- No active year → 400 «لا توجد سنة دراسية نشطة لعرض إحصائياتها». Show the message.

## The screen

**Load once with no filters** and keep that response for the filter lists, so the lists don't shrink as the user filters. Then call again on every filter change.

1. **Heading:** «إحصائيات الطلاب», the school name, «السنة الدراسية: …», and the active filters in one line, e.g. «الفلاتر: المرحلة الابتدائية · بنات · غير سعودي», or «جميع الطلاب» with none.
2. **Filters** (a bottom sheet or a row of chips):
   - المرحلة → الصف (only that stage's grades) → الفصل (only that grade's classes). Changing a stage clears grade and class.
   - الجنس: الكل / بنون / بنات.
   - الجنسية: الكل / سعودي / غير سعودي / غير محدد, then the separate countries (non-Saudi entries of the unfiltered `byNationality`).
   - «مسح الفلاتر».
3. **Cards** (from `total`), each with its percentage of the total: إجمالي الطلاب · البنون · البنات · السعوديون · غير السعوديين · غير محدد الجنسية.
4. **Warning** when `unspecifiedStudents` is not empty: «يوجد N من الطلاب لم تُحدَّد جنسيتهم، ولا يُحتسبون ضمن السعوديين ولا غير السعوديين.» with «عرض الأسماء» → a list of name and class, each opening the student's edit screen. Tapping the «غير محدد الجنسية» card opens the same list.
5. **Residency** (when `residency.nonSaudi > 0`): title «وثائق إقامة الطلاب غير السعوديين», «سارية: valid من nonSaudi», and four tiles: **بدون وثيقة** (`missing`) · **قيد المراجعة** (`pending`) · **منتهية** (`expired`) · **تنتهي خلال 30 يومًا** (`expiringSoon`). Each tile opens its names (with the expiry date for the last two), and each name opens the student's residency section (see `mobile-residency-documents.md`, «The school's side»).
6. **Four tables:** حسب المرحلة · حسب الصف · حسب الفصل · حسب الجنسية.
   - The first three: name (plus المرحلة/الصف where it applies), عدد الفصول (stage and grade only), الإجمالي، بنون، بنات، سعودي، غير سعودي، غير محدد.
   - A switch **«تفصيل الجنس والجنسية»** adds بنون سعوديون، بنات سعوديات، بنون غير سعوديين، بنات غير سعوديات (`maleSaudi`, `femaleSaudi`, `maleNonSaudi`, `femaleNonSaudi`).
   - Nationality table: الجنسية، الإجمالي، بنون، بنات، النسبة.
   - Every table ends with a **«الإجمالي»** row from `total`.
   - On a phone, scroll the tables sideways, or show each row as a card. Both are fine.
7. **Export:** **«مشاركة PDF»** builds a PDF with the heading (school, year, filters), the cards and the four tables, then opens the share sheet. The school prints it or sends it on WhatsApp. **The PDF must show the active filters**, exactly as the heading does.

All text is formal Arabic (فصحى), as above.

## Test (reading مواهب is safe: this screen only reads)

1. With no filters, the total matches the web page (262 at مواهب today).
2. In every row: بنون + بنات = الإجمالي, and سعودي + غير سعودي + غير محدد = الإجمالي.
3. Choose «غير سعودي» + «بنات»: every card and table changes (14 at مواهب today).
4. Choose a stage: only its grades and classes are listed; the grade list only offers that stage's grades.
5. «عرض الأسماء» lists the 5 students without a nationality, and each opens the edit screen.
6. The shared PDF has the school, year and filters at the top.
7. Log in as a teacher: the item does not show.
