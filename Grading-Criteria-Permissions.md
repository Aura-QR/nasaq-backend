# Grading Criteria — Permissions & the Silent Fallback

**For:** backend
**Repo:** `nasaq-backend`, branch `main`
**Status:** decided by the product owner, ready to implement

---

## The decision

Grade **weight distribution** is school policy, not a per-teacher choice.

| Who | What they control |
|---|---|
| **School admins** (Owner / Manager / Supervisor) | The distribution: how the 100 marks split across final, quizzes, assignments, activities, projects — and the subject's `passingGrade` |
| **Teachers** | Everything inside that distribution: writing the exams and quizzes, setting dates, marking students, grading project submissions |

A teacher must not be able to change the split. Two students in `1/1` and `1/2` are compared against each other at promotion time; if each teacher picks their own weighting, they are being measured with different rulers.

Note that the teacher does **not** pick an exam's mark either — `ExamsService.create()` already derives it from the criteria (`quizzes / quizzesCount`, `assignments / assignmentsCount`, and so on). That part is correct and should stay.

---

## Three problems

All three are the same shape: **the rule is written down, but nothing enforces it.** The permission table in `src/permissions/default-permissions.ts` already says exactly the right thing —

```ts
TEACHER: gradesCriteria: { read: true, add: false, edit: false, delete: false }
STUDENT: gradesCriteria: NONE
```

— and it has no effect, because the routes it governs never ask.

---

### 1 · The write routes on `gradesCriteria` are unguarded

**File:** `src/grades-criteria/grades-criteria.controller.ts`

| Line | Route | Guard |
|---|---|---|
| 18 | `POST /gradesCriteria` | none |
| 115 | `PATCH /gradesCriteria/:id` | none |
| 124 | `DELETE /gradesCriteria/:id` | none |
| 93 | `GET /gradesCriteria` | `@CheckAbilities({ read, GradesCriteria })` ✅ |

`AbilitiesGuard` returns `true` when a handler carries no `@CheckAbilities` (`abilities.guard.ts:26`). So a **student's** token can rewrite the grade weights for any subject in the school, and change the passing grade with them.

**Repro:** log in as a student, `POST /gradesCriteria` with a valid `subjectOfferingId` and weights summing to 100 → `201`.

**Fix** — add the decorator to the three write handlers. No new roles, no new table: the permission entries above start working the moment the route asks for them.

```ts
@Post()
@CheckAbilities({ action: 'create', subject: 'GradesCriteria' })
create(@Body() dto: CreateGradesCriteriaDto) { ... }

@Patch(':id')
@CheckAbilities({ action: 'update', subject: 'GradesCriteria' })
update(...) { ... }

@Delete(':id')
@CheckAbilities({ action: 'delete', subject: 'GradesCriteria' })
remove(...) { ... }
```

> **Do not add `@UseGuards(AbilitiesGuard)` to this controller.** `AbilitiesGuard` is already registered globally in `app.module.ts:116`. A class-level `@UseGuards` constructs the guard in *this* module's injector, and `GradesCriteriaModule` does not import `CaslModule` — the app fails to boot with `UnknownDependenciesException`. This exact mistake took the server down once already. `nest build` does not catch it; only booting does.

Action strings map from the table as `add → create`, `edit → update` (`permissions.service.ts:106-107`).

**Optional, same file:** `GET /gradesCriteria/:id` (line 109) is also unguarded, so any authenticated user can read any criteria by id. Adding `@CheckAbilities({ action: 'read', subject: 'GradesCriteria' })` is safe — teachers have `read: true`, and students go through the dedicated `/gradesCriteria/student/me*` routes, which are unaffected.

---

### 2 · `PATCH /schools/me/settings` has no role check

**File:** `src/platform/schools/schools.controller.ts:63-70`

Guarded by `JwtAuthGuard, TenantGuard` only. Any authenticated user in the tenant — including a student — can change:

- `defaultPassingGrade`
- `location`, `checkInRadiusMeters`, `schoolNetworkIps`, `teacherCheckInEnabled` (the entire teacher check-in security model)
- `termsPerYear`, `activeAcademicYearId`, `localNationalityCodes`

**Fix** — use the existing `RolesGuard`, following the precedent already set in `teacher-attendance.controller.ts:35`:

```ts
@Patch('schools/me/settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
async updateMySettings(...) { ... }
```

`RolesGuard` depends only on `Reflector`, so adding it via `@UseGuards` is safe here — no module import needed. (That is what makes it different from the `AbilitiesGuard` case above.)

If the intent is Owner-only rather than all admin roles, narrow the `@Roles` list — that is the whole change.

**Leave `GET /schools/me/settings` as it is.** The teacher check-in screen reads it. Worth a follow-up ticket, not this one: the GET currently returns `schoolNetworkIps` to every role, which is more than a student needs to see.

---

### 3 · Creating an exam silently invents a grading criteria

**File:** `src/exams/exams.service.ts:146-158`

```ts
if (!gradesCriteria) {
  gradesCriteria = await new this.gradesCriteriaModel({
    subjectOfferingId: ...,
    final: 40, assignments: 20, assignmentsCount: 4,
    activities: 10, projects: 15, projectsCount: 1,
    quizzes: 15, quizzesCount: 3,
  }).save();
}
```

When a teacher creates the first exam for a subject that has no criteria yet, the system **makes one up** and persists it. That distribution then governs the subject for the rest of the year. The admin is never asked and never told.

This defeats problems 1 and 2 even after they are fixed: locking down `POST /gradesCriteria` means nothing while `POST /exams` writes the same document through a side door.

**Fix** — refuse, and say why:

```ts
if (!gradesCriteria) {
  throw new BadRequestException(
    'لا يوجد توزيع درجات لهذه المادة. يجب على إدارة المدرسة تحديد توزيع الدرجات قبل إنشاء الامتحانات.',
  );
}
```

**This is a breaking change for the frontend.** `POST /exams` now returns `400` in a case that used to return `201`. The teacher's exam screen needs to surface the message rather than treat it as an unknown failure. Tell the frontend before this ships.

**Existing data:** criteria created by the old fallback are indistinguishable from deliberate ones. This query lists the likely candidates for review — it changes nothing:

```js
db.gradesCriteria.find({
  final: 40, assignments: 20, assignmentsCount: 4,
  activities: 10, projects: 15, projectsCount: 1,
  quizzes: 15, quizzesCount: 3,
})
```

Any school that genuinely wanted that split will show up too, so treat the result as a list to confirm with the school, not a list to delete.

---

## Tests to add

The reason this went unnoticed is that folder **10 · Students must not be able to act** in `Nasaq_Teachers_Students_Attendance.postman_collection.json` covers attendance, exams and teacher check-in — and never touches grading criteria or school settings. Every existing `POST /gradesCriteria` and `PATCH /schools/me/settings` request in both collections runs on the **owner** token, so the refusal path was never exercised.

Add to folder 10:

| Request | Token | Expected |
|---|---|---|
| `POST /gradesCriteria` | student | `403` |
| `POST /gradesCriteria` | teacher | `403` |
| `PATCH /gradesCriteria/:id` | teacher | `403` |
| `DELETE /gradesCriteria/:id` | teacher | `403` |
| `PATCH /schools/me/settings` | student | `403` |
| `PATCH /schools/me/settings` | teacher | `403` |
| `GET /gradesCriteria` | teacher | `200` — teachers must still be able to read it |
| `POST /exams` for an offering with no criteria | teacher | `400`, message mentions توزيع الدرجات |

The last two matter as much as the refusals: they are what stops a later "fix" from locking teachers out of their own subject.

---

## Verifying before you push

`npm run build` and the unit suites are necessary but not sufficient — neither can catch a DI graph error or a guard that silently passes. Boot the app against a real mongod and drive the routes with real tokens for each role.

Five suites (`tenancy`, `dashboards`, `managers`) currently fail on `main` with `mongoose.connect` timeouts, unrelated to this work. Confirm any failure you see also fails on the base commit before chasing it.

---

## Why these three are one ticket

Fixing any one of them alone leaves the hole open:

- Guard `POST /gradesCriteria` but keep the exam fallback → teachers still set the distribution, just implicitly
- Guard both but leave `PATCH /schools/me/settings` open → anyone can move the passing grade underneath the whole school
