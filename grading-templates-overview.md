# Grading Templates: Flexible and Ministry (Annual Register)

**Status: the backend is built and deployed** (backend `ec70b20`). This file
explains the idea. The API is in `grading-ministry-template-api.md`. All UI
copy stays in formal Arabic.

---

## 1. Why

Today Nasaq has one way to grade:

- The school splits the 100 marks of each subject itself, in «معايير
  الدرجات». For example: final 40, assignments 20, quizzes 20, and so on.
- Teachers create electronic exams. Students take them on the app, and the
  system marks them automatically.
- The system adds the marks up. Passing and promotion come from that total.

Mawahib (مواهب المملكة) follows the **Saudi Ministry of Education model**,
where the split is **fixed** and the school does not choose it. We still
want Nasaq to work as a SaaS for every school. So the answer is not to
change the current system. Instead, each school chooses one of two
**grading templates**.

## 2. The two templates

A new school setting, **«نظام الدرجات»** (grading system):

| | **Flexible** (today's system, default) | **Ministry** (new) |
|---|---|---|
| Who sets the split | The school, per subject | Fixed by the template, not editable |
| What the admin does | Fills «معايير الدرجات» for each subject | Marks each subject as *continuous* or *final exam* |
| Where marks come from | Electronic exams and projects | Daily tracking, quizzes (paper and electronic), final exam |
| Teacher's grade view | As today | The **annual register** (السجل السنوي) per class |
| Student's «درجاتي» | As today | Shows the annual register |
| Passing and promotion | From the criteria | From the annual register |

- **Every school starts on Flexible**, so nothing changes for existing
  schools.
- Mawahib switches to **Ministry**. Any later Saudi school can choose it
  and it works out of the box.
- **Only the owner** marks each subject as continuous or final exam.
  Teachers never touch the split.
- **Proposed:** the template can be changed only before any mark is
  recorded in the year. After that it is locked, so the system never
  switches mid-term.

## 3. The Ministry template: two kinds of subject

Every subject is out of 100.

**Continuous assessment (تقويم مستمر / تكويني):** no end-of-term exam.

| Part | Marks |
|---|---|
| Performance tasks, participation and interaction (المهام الأدائية والمشاركة والتفاعل) | 40 |
| Written assessments and varied tools (تقويمات تحريرية وأدوات تقويم متنوعة) | 60 |

**Final-exam subjects (تقويم ختامي):**

| Part | Marks |
|---|---|
| Performance tasks, participation and interaction | 40 |
| Written assessments (تقويمات تحريرية) | 20 |
| End-of-term exam (اختبار نهاية الفترة) | 40 |

Activity subjects («نشاط غير دراسي»: breakfast, play) are never in the
register.

## 4. Where each part comes from

Teachers learn nothing new. They keep recording daily tracking and setting
exams as they do today. The system fills the register.

### 4.1 The 40: participation and interaction (automatic)

This part comes from the **daily tracking sheet** (سجل المتابعة) the teacher
already fills every period.

- **Participation** and **homework** stay **ticks** (✓ or ✗).
- The system turns them into marks. For example, a student who
  participated in 90% of the periods she attended gets 90% of the
  participation share.
- **Days absent do not lower the mark.** Rates are counted only over the
  periods she attended.

### 4.2 Written assessments: quizzes (paper and electronic)

There are two kinds of quiz. **Both count:**

**Paper quiz.** The teacher gives a quiz on paper or on the board and marks
it herself. This is why Mawahib asked for the quiz column to become a
**number** instead of ✓ or ✗. The teacher's steps:

1. She gives the quiz in class and marks it.
2. She opens **that same period** in the attendance and tracking screen, for
   the day of the quiz.
3. At the top she enters **«الدرجة العظمى للاختبار»** (out of), for
   example 10.
4. Next to each student she types the mark (7, 9, 6…) and saves.

```
Maths period — Sunday 12 Oct            Quiz out of: [10]

Student     Present   Participated   Homework   Quiz
Sara          ✓            ✓             ✓       [ 8 ]
Noura         ✓            ✓             ✗       [ 6 ]
Reem          ✗            —             —       [ — ]   ← absent: locked
```

- **No quiz that period:** the column stays empty. That means "no quiz",
  and it is never counted as 0.
- **The only change** to today's screen: the quiz column was ✓ or ✗, and it
  becomes a number field.

**Electronic quiz.** Unchanged. The teacher creates it, students take it on
the app, and it is **marked automatically**. Its percentage counts toward
the written part.

### 4.3 The end-of-term exam (final-exam subjects only)

There are two ways. The school uses whichever fits:

**Electronic final.**
- The teacher creates an exam of type «نهائي», as today. It is already
  **one final per subject per grade**, sent to every class of the grade.
- Students take it on the app, and it is marked automatically.
- The system **converts the percentage to 40**. For example, 45 of 50
  questions right is 90%, which becomes **36 / 40** in the register.
- The teacher types nothing. She may still correct one student's mark, for
  example if a phone failed.

**Paper final.**
- The exam is taken on paper and the teacher marks it.
- In the new **annual register** screen, she types each student's mark in
  the **«اختبار نهاية الفترة (40)»** column.

Continuous-assessment subjects have **no final column at all**.

## 5. The annual register (السجل السنوي)

The annual register is a table for each class and subject, per term. There
is one row per student: her mark in each part, and the total out of 100.

```
Annual register — Maths — Grade 7/A — Term 1   (final-exam subject)

Student   Participation (40)   Written (20)   End of term (40)   Total
Sara            33 ⚙️              17 ⚙️           [ 36 ]           86
Noura           28 ⚙️              14 ⚙️           [ 31 ]           73

⚙️ calculated by the system from daily tracking and quizzes
[ ] filled automatically from an electronic final, or typed by the teacher for a paper one
```

- **The admin opens it, reviews, prints and approves it.**
- **Passing and promotion read from it.** The passing mark comes from the
  school settings, as today.
- **Once approved,** that subject's daily tracking for that class is
  locked. Nobody can go back and change past days and so move the marks.
- **A missing part** shows as «غير مكتمل» (incomplete), never as 0.

## 6. Worked example

Sara, maths, **continuous** subject (40 + 60), over one term:

- **Attended 40 periods:** participated in 36 (90%), brought homework in 30
  (75%).
- **Quizzes:** 3 on paper (8/10, 9/10, 7/10) and 1 electronic (4/5). That
  is 28 out of 35, or 80%.

| Part | Calculation | Mark |
|---|---|---|
| Participation and interaction | 90% × 20 + 75% × 20 | 33 / 40 |
| Written assessments | 80% × 60 | 48 / 60 |
| **Total** | | **81 / 100** |

## 7. Decisions taken (built this way, easy to change)

1. **Do quizzes count toward written assessments, not the 40?**
   *Proposed: yes.* A quiz is written work; the 40 is "participation and
   interaction".
2. **How is the 40 split?** *Proposed: 20 participation + 20 homework.*
3. **Can the teacher add a manual written mark** (a worksheet or a research
   task) besides quizzes? *Proposed: yes, as a simple extra column.*
4. **Do electronic assignments and projects** (المهام الأدائية) **count
   toward the 40?** *Proposed: yes.* The split then becomes 15
   participation + 15 homework + 10 tasks and projects.

## 8. What stays the same

| Existing feature | Under the Ministry template |
|---|---|
| Curriculum distribution (lessons over the weeks) | Unchanged. It is about lessons, not marks |
| Subject offerings (subject × grade × term, periods per week) | Unchanged. The register is per offering and class |
| «Required for promotion» on a subject | Unchanged |
| Every subject out of 100 | Unchanged |
| Pass mark | The school default, or a subject's own pass mark set next to its type |
| Yearly result (average of the terms) | Unchanged. Each term's mark comes from the approved register |
| «معايير الدرجات» (weights and counts) | Hidden. Its data is kept, in case the school goes back |
| Limit on the number of quizzes | None. Every quiz counts toward written assessments |

- Schools on the Flexible template see **no change at all**, apart from the
  quiz column becoming a mark.
- Electronic exams, automatic marking, the one-final-per-grade rule and the
  exam safeguards stay as they are. In the Ministry template, exams simply
  feed the register instead of «معايير الدرجات».

## 9. Delivery in two phases

**Phase 1 (fastest, so Mawahib can start):**
- The quiz column becomes a number, on web and mobile.
- The school picks its template, and the owner marks each subject.
- **The annual register on web**, calculated automatically, to view and
  print.
- Electronic exams work in the Ministry template without «معايير الدرجات».

**Phase 2:**
- Manual columns (paper final, extra written marks).
- Approving the register, and locking daily tracking.
- Passing and promotion from the register.
- The new «درجاتي» for students, and the register on mobile.
