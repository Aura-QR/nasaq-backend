# Web: «إحصائيات الطلاب» page

**For:** Arwaa (`nasaq-frontend`).
**Why:** the school prepares statistical reports of its students: how many per stage, per grade and per class, how many boys and girls, how many Saudi and non-Saudi, and any combination of these (e.g. non-Saudi girls in the primary stage).
**Backend:** ready. `GET /students/statistics` (below). No other endpoint is needed.
**Who sees it:** the same people who can open the students list (OWNER, SUPERVISOR, MANAGER with the read-students permission).

## The endpoint

```
GET /students/statistics?stageId=&gradeLevelId=&classId=&gender=&nationality=
```

All parameters are optional, and an empty value means no filter.

| Param | Values |
|---|---|
| `stageId` | a stage id |
| `gradeLevelId` | a grade id |
| `classId` | a class id |
| `gender` | `male` · `female` |
| `nationality` | `saudi` · `non_saudi` · `unspecified` · an ISO code such as `EG` (the codes are the ones in `/nationalities`) |

- It counts **this academic year only** (the active year) and only active students in this year's classes.
- **Every breakdown is computed after the filters.** With `nationality=non_saudi`, `byClass` gives the non-Saudis of each class. With `stageId=…`, `byNationality` gives the nationalities of that stage only. So one call fills the whole page for whatever the user picked.
- Stages, grades and classes with **no matching student are still listed, with zeros**.
- Nationality is read from the code, or else from the text saved on the student. Most students at مواهب have only the text («المملكة العربية السعودية»), and they are counted correctly. A student with no nationality counts as **«غير محدد»**, neither Saudi nor non-Saudi.

### Response (`data`)

Each counts block has the same fields:

```json
{
  "total": 262, "male": 85, "female": 177,
  "saudi": 242, "nonSaudi": 15, "unspecifiedNationality": 5,
  "maleSaudi": 0, "maleNonSaudi": 0, "femaleSaudi": 0, "femaleNonSaudi": 0
}
```

```json
{
  "academicYear": { "_id": "…", "name": "1448" },
  "filters": { "gender": "female" },
  "total": { …counts },
  "byStage":      [{ "stageId": "…", "name": "الابتدائية", "classCount": 6, …counts }],
  "byGradeLevel": [{ "gradeLevelId": "…", "name": "الأول", "stageId": "…", "stageName": "الابتدائية", "classCount": 2, …counts }],
  "byClass":      [{ "classId": "…", "name": "أول أ", "classGender": "female", "gradeLevelId": "…", "gradeLevelName": "الأول", "stageId": "…", "stageName": "الابتدائية", …counts }],
  "byNationality":[{ "code": "SA", "label": "سعودي", "isSaudi": true, "total": 242, "male": 80, "female": 162 },
                   { "code": null, "label": "غير محدد", "isSaudi": false, "total": 5, "male": 1, "female": 4 }]
}
```

- `byStage` and `byGradeLevel` are in the school's order; `byClass` is by class name. `byNationality` is largest first, with «غير محدد» last.
- With no active year: 400 «لا توجد سنة دراسية نشطة لعرض إحصائياتها». Show the message.

## The page

**Route:** `/school/students/statistics`. Add an entry «إحصائيات الطلاب» in the sidebar under the students section, and a button «الإحصائيات» on the students list page.

### 1. Filters (top bar)
- **المرحلة**, **الصف** (only the selected stage's grades), **الفصل** (only the selected grade's classes): the same lists the students page already loads.
- **الجنس:** الكل / بنين / بنات.
- **الجنسية:** الكل / سعودي / غير سعودي / غير محدد, then the separate countries (from `/nationalities`).
- Each change calls the endpoint again. A «مسح الفلاتر» button resets all.

### 2. Summary cards (from `total`)
إجمالي الطلاب · البنون · البنات · السعوديون · غير السعوديين · غير محدد الجنسية.

### 3. Tables (one tab or section each)
| Section | Rows | Columns |
|---|---|---|
| حسب المرحلة | `byStage` | المرحلة، عدد الفصول، الإجمالي، بنون، بنات، سعودي، غير سعودي، غير محدد |
| حسب الصف | `byGradeLevel` | الصف، المرحلة، then the same columns |
| حسب الفصل | `byClass` | الفصل، الصف، المرحلة، then the same columns |
| حسب الجنسية | `byNationality` | الجنسية، الإجمالي، بنون، بنات، النسبة % |

- Each table ends with a **«الإجمالي»** row equal to `total`.
- In the first three tables, show a detailed view (a toggle «تفصيل الجنس والجنسية») that adds: سعودي بنون، سعودي بنات، غير سعودي بنون، غير سعودي بنات (`maleSaudi`, `femaleSaudi`, `maleNonSaudi`, `femaleNonSaudi`).
- Percentages: `count / total.total`, one decimal place. When the total is 0, show «—».
- A simple chart is welcome (boys/girls and Saudi/non-Saudi as two donuts, and a bar per stage). Optional.

### 4. Export and print
- **«تصدير Excel»:** one sheet per table, with the active filters written at the top (e.g. «المرحلة: الابتدائية · الجنس: بنات»), the school name and the academic year.
- **«طباعة»:** a print stylesheet that shows the title, school name, year, filters and the tables, and hides the sidebar and buttons.

All text is formal Arabic (فصحى), as above.

## Test (مواهب is safe here: the page only reads)

1. With no filters, the total matches the students count on the students page (262 at مواهب today).
2. Saudi + non-Saudi + غير محدد = total, and بنون + بنات = total, in every row.
3. Choose «غير سعودي»: the cards and every table show non-Saudis only.
4. Choose a stage: only that stage's grades and classes are listed, and the nationality table covers that stage only.
5. A class with no students still shows, with zeros.
6. Excel export opens with one sheet per table and the filters at the top. Printing shows no sidebar.
