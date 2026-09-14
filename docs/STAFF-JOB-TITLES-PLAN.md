# Staff Job Titles — Plan

> Status: **Phases 1–2 released** (`cd84ed2`, `5db67c1`). **Phases 3–5 implemented, not yet released.** The `staffAttendance` key is owned by the staff-attendance fix; once it lands in `MANAGER_PERMISSIONS` it becomes a box on every title automatically (withheld until ticked).
> As built, assignment is `PATCH /job-titles/assignments/:accountId` with `{ type: 'admin' | 'teacher', jobTitleId | null }` (not `/managers/:id/job-title`), and the managers table assigns inline from a dropdown in the role column.
> Starter titles: «المالية», «وكيل شؤون الطلاب», «وكيل شؤون المعلمين», «المسؤول الأكاديمي».
> Scope: `nasaq-backend`, `nasaq-frontend`. `nasaq_mobile` is not changed.

## 1. The request

A school has several administrative assistants (role `MANAGER`, shown as «مساعد إداري»). Today they all share **one** permission set, so every change on the permissions screen applies to all of them at once.

The school wants each assistant to do one job:

- one handles **finance** (fees, payments, expenses)
- one handles **everything about students**
- one handles **everything about teachers**
- and so on

## 2. Decision

**Do not add new roles. Add job titles on top of the existing `MANAGER` role.**

A *job title* is a named, school-owned permission template — for example «المالية». The owner creates titles, then assigns one to each assistant. At login, an assistant with a title receives that title's permissions; an assistant without one keeps today's `MANAGER` permissions.

### Why not new roles (`ACCOUNTANT`, `STUDENT_AFFAIRS`, …)

The role name is hard-wired throughout the system:

- 77 `@Roles(...)` decorators on the backend list `MANAGER` by name. Every one would need the new roles added, and any one we miss is a silent 403 for that user.
- The `Role` enum, the `Permission` schema enum, login, forgot-password and OTP flows all branch on role.
- Web login and routing, and the mobile login form, forgot-password screen and manager screens, all branch on role.

That is a system-wide change that has to be tested everywhere, for a result the job titles give without touching any of it.

### Why not per-account checkboxes

- The owner re-ticks the same boxes for every accountant.
- A new hire starts from a blank slate.
- A change to "what an accountant does" has to be repeated on every account.
- Nothing on screen says what each person's job is.

### What job titles give

| | New roles | Per-account boxes | **Job titles** |
|---|---|---|---|
| Login / mobile / role checks untouched | ❌ | ✅ | ✅ |
| Set up once, reuse for new staff | ✅ | ❌ | ✅ |
| One edit updates everyone with that job | ✅ | ❌ | ✅ |
| Owner can adjust without a developer | ❌ | ✅ | ✅ |
| Nobody changes until the owner acts | ❌ | ✅ | ✅ |

## 3. How permissions work today

1. At login, `AuthService` builds a flat list such as `school.students.read`, `school.financial.update` and signs it into the JWT.
   - `OWNER` / `SUPERVISOR` → `['*']` (everything).
   - `MANAGER` → the school's `MANAGER` row in the `permissions` collection (defaults in `src/permissions/default-permissions.ts`).
   - A teacher with `isManager: true` → teacher permissions merged with the `MANAGER` row.
2. `CaslAbilityFactory` turns that list into abilities; the global `AbilitiesGuard` enforces `@CheckAbilities({ action, subject })` on endpoints that declare it.
3. The frontend reads the same list (`usePermissions`) to hide menu items and buttons.
4. The permissions screen (`/school/permissions`) edits the per-school `MANAGER`, `TEACHER` and `STUDENT` rows.
5. Permissions live in the token, so a change takes effect at the user's **next login**.

## 4. Gap that must be fixed first

**Several checkboxes on the permissions screen are only enforced by the UI, not by the server.**

Those endpoints are guarded by `@Roles(..., MANAGER, ...)` only, which asks "are you a manager?", never "does your permission set allow this?". Unticking the box hides the button; a direct API call still succeeds.

| Area | Server enforces the checkbox today? |
|---|---|
| Financial (records, payments, bus, trips, additional fees, discounts, void) | ✅ |
| Financial settings (fee configs, installment plans, bus plans, trip modules) | ✅ |
| Expenses, expense categories | ✅ — but checked as `Financial`, not `expenses` |
| Attendance, exams, projects, preparation, grades criteria | ✅ |
| **Teachers** | ❌ (the controller imports `CheckAbilities` but no endpoint uses it) |
| **Students** (`students.controller`) | ❌ |
| **Enrollments** | ❌ |
| **Classes** | ❌ |
| **Subjects, subject offerings** | ❌ |
| **Lectures / timetable** | ❌ |
| **Library** | ❌ |
| **Curriculum** | ❌ |
| **Teacher attendance** | ❌ |
| **Duty (المناوبة)** | ❌ |
| **Teacher assignments, teacher constraints** | ❌ |
| **Stages, grade levels, terms** | ❌ |
| **Academic years** — create / edit | ❌ (menu hidden for managers, API allows; only delete is owner/supervisor) |
| **School settings** (`PATCH /schools/me/settings`: timezone, check-in location, passing grade…) | ❌ any manager |
| **Messaging deliveries** (view, retry) | ❌ any manager |
| **Staff attendance** — records, absence list, summary, manual entry, edit, delete (`/staff-attendance`, added in `e13cc1c`) | ❌ any manager, **including on their own record** — see `docs/STAFF-ATTENDANCE-REVIEW.md` |

Example: if the accountant's title unticks everything under Students, the Students menu disappears for them, but `DELETE /students/:id` still succeeds for their token. **Without this fix, splitting assistants is cosmetic.**

This already affects schools today, without job titles: the live permissions screen for one school has «حذف» unticked for students, teachers, classes and subjects, yet any assistant can still delete all four through the API.

### Verified locally (2026-09-14)

Built backend (`72a2dd2`) against a throwaway database. The school, data and manager were created through the API; the owner unticked `delete` on students, teachers, classes and subjects and unticked all of `financial` through `PATCH /permissions/MANAGER`. Then, as the manager:

| Action | Box | Result |
|---|---|---|
| `DELETE /students/:id` | unticked | **200 — deleted** |
| `DELETE /teachers/:id` | unticked | **200 — deleted** |
| `DELETE /subjects/:id` | unticked | **200 — deleted** |
| `DELETE /classes/:id` | unticked | **200 — deleted** |
| `GET /financial/records` | unticked | 403 — correctly refused (control) |
| `GET /expenses` | `financial` unticked | 403 — correctly refused (control) |
| `POST /academic-years` | not on the screen | **201 — created** |
| `GET /dashboards/manager` | default manager | returns **only** `students`; owner-level returns students, teachers, classes, attendanceToday, financial |
| Login token of a default manager | — | has `school.financial.read`, has **no** `school.expenses.*` |

### Related defects found while reviewing

1. `CaslAbilityFactory.ENTITY_TO_SUBJECT_MAP` has no entry for `subjects` or `library`, so those permissions are silently dropped even where a check would be added.
2. **Expenses menu is hidden from every manager.** The sidebar's «المصروفات» items require `school.expenses.read`. `MANAGER` defaults have no `expenses` key, so the token never carries it — verified above. The server, meanwhile, lets the same manager in, because the expense endpoints check `Financial`.
3. **Manager dashboard shows students only.** `DashboardsService.getManagerDashboard` gates teachers, classes, attendance and financial metrics on `school.<x>.manage`, a string login never produces (it only emits read/create/update/delete). Only the students card, gated on `.read`, ever appears — verified above.
4. `PermissionsService.getFlatPermissions` looks up the school row with `{ schoolId, role }` without `userId: null`. Harmless today; once more than one row per school and role exists, it could return the wrong one.

## 5. Plan

Each phase ships on its own and leaves the system working.

### Phase 1 — Make the server enforce every checkbox

**Goal:** every box on the permissions screen means the same thing to the server as to the UI. No visible change for anyone.

1. Add the missing entries to `ENTITY_TO_SUBJECT_MAP` (see the key list in Phase 2).
2. Add `@CheckAbilities` to the admin endpoints in the ❌ controllers above.
3. **Rule for endpoints teachers or students also call** (e.g. `GET /classes/teacher/me`, lists teachers read):
   - Endpoints whose `@Roles` excludes `TEACHER` and `STUDENT` → add the ability check directly.
   - "Me" endpoints (`/teacher/me`, `/student/me`) → leave role-based; they are already scoped to the caller.
   - Shared read endpoints → before adding the check, confirm the `TEACHER` / `STUDENT` defaults grant that read. If they don't (e.g. `subjects` is `NONE` for teachers), either grant the read or keep the endpoint role-based, and write down which.
4. Expenses: introduce an `expenses` subject and check it on the expense endpoints. Backfill `expenses` into every existing `MANAGER` row as a copy of its current `financial` value, so nobody loses access.
5. Fix defect 2 (expenses menu) — solved by step 4, since the token then carries `school.expenses.*`.
6. Fix defect 3 (dashboard): gate each metric on `.read`, not `.manage`.
7. Fix defect 4 (lookup query).
8. Guard academic years create/edit, school settings and messaging deliveries with their new keys (Phase 2).
9. Staff attendance — see [Staff attendance](#staff-attendance) below. This step can ship ahead of the rest of Phase 1, because it closes a live hole.

**As implemented — two decisions not in the first draft:**
- **Read routes shared with teachers and students** carry `@CheckAbilities({ ..., roles: [Role.MANAGER] })`. The `roles` option applies a requirement only to those roles, so a teacher's `teachers: NONE` never blocks `GET /teachers/list`. Staff-only routes (their `@Roles` excludes TEACHER and STUDENT) get a plain check. `src/permissions/permission-enforcement.spec.ts` sweeps every controller and fails on a manager-reachable staff-only route with no check.
- **Tokens signed before this release** carry none of the new keys. Login now stamps `permissionsVersion: 2`; a MANAGER token without it keeps its pre-release reach on the newly enforced areas (`CaslAbilityFactory`), so nobody logged in at deploy is locked out. It stops mattering after one token lifetime (`JWT_EXPIRE_IN`).

Reference data reads (academic years, stages, grade levels, terms, school settings `GET`) stay open: nearly every screen needs them.

**Why nothing changes for current assistants:** the `MANAGER` defaults already grant these areas, and `ensureDefaultsMerged` backfills any new key into existing rows.

**Tests:**
- For every newly guarded endpoint, a spec proving a token without the permission gets 403 and one with it succeeds.
- A regression pass logged in as a teacher, a student and a default manager over the screens they use.

### Phase 2 — Complete the permission keys

The screen should list every area a title needs to grant or withhold. Final key list, grouped the way the screen shows it:

| Key | Screen label | Covers (backend) | New? |
|---|---|---|---|
| `students` | الطلاب | students, **enrollments** | enrollments added |
| `attendance` | حضور الطلاب | attendance | — |
| `teachers` | المعلمون | teachers, **teacher assignments, teacher constraints** | assignments/constraints added |
| `teacherAttendance` | حضور المعلمين | teacher attendance | **new on screen** |
| `duty` | المناوبة | duty | **new** |
| `classes` | الفصول | classes | — |
| `subjects` | المواد | subjects, subject offerings | offerings added |
| `lectures` | الحصص والجدول | lectures / timetable | — |
| `curriculum` | المناهج | curriculum | **new on screen** |
| `academicStructure` | الهيكل الدراسي | stages, grade levels, terms | **new** |
| `library` | المكتبة | library | — |
| `gradesCriteria` | توزيع الدرجات | grades criteria | — |
| `exams` | الاختبارات | exams | — |
| `projects` | المشروعات | projects | — |
| `grades` | الدرجات | grades | — |
| `preparation` | التحضير | preparation | — |
| `financial` | الماليات | records, payments, bus, trips, additional fees, discounts | — |
| `financialSettings` | إعدادات الرسوم | fee configs, installment plans, bus plans, trip modules | — |
| `expenses` | المصروفات | expenses, expense categories | **enforced separately** |
| `academicYears` | السنوات الدراسية | academic years create / edit (delete stays owner/supervisor) | **new** |
| `schoolSettings` | إعدادات المدرسة | `PATCH /schools/me/settings` | **new** |
| `messaging` | سجل الرسائل | messaging deliveries view / retry | **new** |
| `staffAttendance` | حضور الإداريين والمشرفين | staff attendance records, absence list, summary, staff list, manual entry, edit, delete — **not** self check-in | **new** |

`academicYears`, `schoolSettings` and `messaging` default to allowed for `MANAGER`, because any manager can do them today. They exist so a job title can **withhold** them — an accountant should not be able to move the school's check-in location or timezone.

`staffAttendance` is the one exception to "nobody loses access": it defaults to **none** for `MANAGER`. Today's access lets an assistant forge their own attendance, so it is removed rather than preserved, and granted back deliberately per title.

### Staff attendance

Staff attendance splits into two parts that are governed differently.

**1. «حضوري» — self check-in, not a permission.**
`POST /staff-attendance/check-in`, `POST /staff-attendance/check-out`, `GET /staff-attendance/me` stay role-based for `MANAGER` and `SUPERVISOR`. Every assistant can record their own day by location whatever their job title, including one with no title. No job title can remove it.

**2. «حضور الإداريين والمشرفين» — the `staffAttendance` key.**

| Box | Allows | Endpoints |
|---|---|---|
| read | see everyone's records, the absence list, the summary, the staff picker | `GET /staff-attendance`, `/absent`, `/summary`, `/staff` |
| add | record a manual check-in for someone | `POST /staff-attendance` |
| edit | correct someone's times or notes | `PATCH /staff-attendance/:id` |
| delete | delete someone's record | `DELETE /staff-attendance/:id` |

Each endpoint gets `@CheckAbilities({ action, subject: 'StaffAttendance' })` in place of today's role-only gate. `OWNER` and `SUPERVISOR` pass automatically (`['*']`).

**Fixed rule on top of the key — no one touches their own record by hand.**
- `createManual`: refuse when `dto.staffId === user.userId`.
- `update` and `delete`: refuse when `record.staffId === user.userId`.
- Message: «لا يمكن تسجيل أو تعديل أو حذف حضورك بنفسك. اطلب ذلك من مالك المدرسة.»
- This holds even with every box ticked, and for `SUPERVISOR`. Own attendance only ever comes from location check-in, or from someone else.

**Defaults**

| Who | `staffAttendance` |
|---|---|
| `OWNER`, `SUPERVISOR` | everything (by `['*']`), except their own record by hand |
| `MANAGER` with no title | none |
| Starter templates | none — the owner ticks it on whichever title should follow attendance |

**Example**

| Assistant | Title | `staffAttendance` boxes | Can do |
|---|---|---|---|
| مي | المسؤول المالي | none | «حضوري» only |
| نجلاء | وكيل شؤون الطلاب | none | «حضوري» only |
| فيصل | وكيل شؤون المعلمين | read + add + edit | «حضوري»; sees everyone; records and corrects **others**; refused on his own record |

**Frontend**
- «حضور الإداريين والمشرفين»:
  - The sidebar item and the route are shown by `usePermissions('staffAttendance').read`, not by role.
  - Add / edit / delete buttons follow their boxes.
  - Edit and delete are hidden on the signed-in user's own row.
- «حضوري» stays shown for `MANAGER` and `SUPERVISOR` by role.
- The edit-dialog time bug in `docs/STAFF-ATTENDANCE-REVIEW.md` (issue 2) is fixed separately; it is not a permissions change.

**Shipping it early.** The review found the hole live today. Rather than a temporary `@Roles(OWNER, SUPERVISOR)` patch that Phase 1 would rewrite, ship this sub-section on its own now:
1. Add the `StaffAttendance` subject to `CaslAbilityFactory`.
2. Add `staffAttendance: NONE` to `MANAGER_PERMISSIONS`; `ensureDefaultsMerged` backfills existing rows.
3. Add the `@CheckAbilities` decorators and the own-record rule.
4. Make the frontend changes above, and add the card to the permissions screen.

The result today is the same as the quick patch — assistants lose the management page and keep «حضوري» — and it is already in the shape job titles need.

**Never grantable by a title.** These stay owner/supervisor-only exactly as today:
- Managing admin accounts and the permissions screen itself.
- Deleting an academic year.
- Sending a WhatsApp test message (`POST /messaging/test`).

Defaults for the new keys:
- `MANAGER` gets the same reach it effectively has today, so nobody loses access.
- `TEACHER` and `STUDENT` get whatever they currently reach through role-only endpoints, decided per endpoint in Phase 1.

### Phase 3 — Job titles on the backend

**New collection `jobTitles`** (tenant-scoped):

```ts
{
  schoolId: ObjectId,        // injected by tenantScopedPlugin
  name: string,              // «المالية» — unique per school
  templateKey?: string,      // 'finance' | 'studentAffairs' | 'teacherAffairs' | 'academic' — which starter it came from
  permissions: Record<string, { read, add, edit, delete }>,
  createdBy, updatedBy, timestamps
}
```

**New optional field** `jobTitleId` on:
- `Admin` (role `MANAGER`)
- `Teacher`, for promoted teachers (`isManager: true`)

**Login** (`AuthService`):

```
MANAGER:
  if admin.jobTitleId and the title exists → permissions = title.permissions
  else                                     → permissions = school MANAGER row   (today's behaviour)

TEACHER with isManager:
  manager part = title.permissions if jobTitleId, else school MANAGER row
  permissions  = teacher permissions ∪ manager part                           (today's merge)
```

If a title is deleted while assigned, login falls back to the `MANAGER` row. Delete is also refused while the title is assigned, with the count of accounts using it.

**Endpoints.** Only `OWNER` and `SUPERVISOR` may call them, using the same explicit role check as `PermissionsController`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/job-titles` | list, with the number of assistants on each |
| `GET` | `/job-titles/templates` | the starter templates (read-only, not stored) |
| `POST` | `/job-titles` | create — from a template (`templateKey`) or blank |
| `PATCH` | `/job-titles/:id` | rename / replace permissions |
| `DELETE` | `/job-titles/:id` | refused while assigned |
| `PATCH` | `/managers/:id/job-title` | assign or clear (`jobTitleId: null`) |

**Validation:**
- DTOs declare every field; the global `whitelist` + `forbidNonWhitelisted` pipe applies.
- Unknown permission keys → 400.
- Every key → `{ read, add, edit, delete }` booleans.
- Keys that no title may grant (section 5, Phase 2) → 400.
- `exams` / `projects` / `preparation` `add`/`edit` → forced false, as on `MANAGER` today, because creating them is a teacher-only action.

**Guarantee:** until the owner assigns a title, every login produces exactly the same token it does today.

**Tests:**
- Login with no title returns a token identical to today's.
- Login with a title returns the title's permissions, including the promoted-teacher merge.
- A deleted or missing title falls back to the `MANAGER` row.
- Assign, clear and delete are refused for `MANAGER` callers, and deleting an assigned title is refused.
- Validation rejects unknown keys and forbidden grants.
- Tenant isolation: a title from school A cannot be assigned in school B.

### Phase 4 — Frontend

1. **Permissions page** gets a fourth tab, «المسميات الوظيفية».
   - A list of titles: name, number of assistants, edit, delete.
   - «إضافة مسمى» → pick a starter template or start blank → the same checkbox cards used for roles.
   - The existing «المساعدون الإداريون» tab stays and is relabelled «الصلاحيات الافتراضية للمساعدين (بدون مسمى)».
2. **Add / edit assistant dialog**: a «المسمى الوظيفي» dropdown. The first option is «بدون مسمى — الصلاحيات الافتراضية».
3. **Managers table**: the «الدور» column shows the title (e.g. «المالية»); assistants without one still show «مساعد إداري».
4. **After saving** a title or assigning one, show: «التغيير يسري عند تسجيل الدخول القادم لهذا المستخدم».
5. **Menus and buttons**: no change needed — the sidebar and pages already read `usePermissions`. Verify each page with a limited token (below).
6. **Home dashboard**: a limited assistant must not see error cards for areas they can't read. Each widget checks its permission before calling its endpoint.
7. Remove the unused `ManagerPermissionsDialog.jsx` (not imported anywhere; it edits the per-account array login no longer reads).

### Phase 5 — Starter templates

Templates are starting points. The owner can edit any box after creating a title from one.

No template grants `staffAttendance`, and self check-in («حضوري») is available under every template — see [Staff attendance](#staff-attendance).

Legend: **R** read · **A** add · **E** edit · **D** delete · `—` none

#### «المالية» — Finance

Runs the money: collects fees, records and corrects payments, applies discounts, records expenses. **Does not set prices** — tuition amounts and installment plans are an owner decision, so they are read-only here.

| Key | R | A | E | D | Why |
|---|---|---|---|---|---|
| `financial` | ✅ | ✅ | ✅ | ✅ | payments, refunds, bus, trips, additional fees, discounts |
| `financialSettings` | ✅ | — | — | — | sees fee configs and plans, can't change prices |
| `expenses` | ✅ | ✅ | ✅ | ✅ | records the school's spending |
| `students` | ✅ | — | — | — | finds a student to collect from |
| `classes` | ✅ | — | — | — | filters fees by class |
| everything else | — | — | — | — | |

Voiding a payment keeps its own rule on top of this: the person who recorded it may void it the same day; otherwise only the owner.

#### «وكيل شؤون الطلاب» — Student affairs deputy

Everything about students: admission, data, class placement, accounts, attendance, and following their results.

| Key | R | A | E | D | Why |
|---|---|---|---|---|---|
| `students` | ✅ | ✅ | ✅ | ✅ | add, edit, enroll/move between classes, reset password, activate/deactivate, delete |
| `attendance` | ✅ | ✅ | ✅ | ✅ | records and corrects student attendance |
| `classes` | ✅ | — | — | — | places students into existing classes |
| `grades` | ✅ | — | — | — | follows student results |
| `exams` | ✅ | — | — | — | follows exams |
| `projects` | ✅ | — | — | — | follows projects |
| `gradesCriteria` | ✅ | — | — | — | understands how grades are split |
| `lectures` | ✅ | — | — | — | sees a class's timetable |
| everything else | — | — | — | — | no finance, no teachers |

#### «وكيل شؤون المعلمين» — Teacher affairs deputy

Everything about teachers: accounts, which subjects and classes they teach, their timetable and constraints, their attendance and duty, and following their preparation and assessments.

| Key | R | A | E | D | Why |
|---|---|---|---|---|---|
| `teachers` | ✅ | ✅ | ✅ | ✅ | accounts, assignments, constraints, reset password, activate/deactivate |
| `teacherAttendance` | ✅ | ✅ | ✅ | ✅ | teacher attendance |
| `duty` | ✅ | ✅ | ✅ | ✅ | duty rota |
| `lectures` | ✅ | ✅ | ✅ | ✅ | builds and edits the timetable |
| `preparation` | ✅ | — | — | — | follows lesson preparation |
| `exams` | ✅ | — | — | — | follows exams teachers set |
| `projects` | ✅ | — | — | — | follows projects teachers set |
| `subjects` | ✅ | — | — | — | needed to assign subjects |
| `classes` | ✅ | — | — | — | needed to assign classes |
| `library` | ✅ | — | — | — | sees teaching material |
| everything else | — | — | — | — | no finance, no student data |

#### «المسؤول الأكاديمي» — Academic structure (optional)

Sets up what is taught and where, before the year starts.

| Key | R | A | E | D |
|---|---|---|---|---|
| `academicStructure` | ✅ | ✅ | ✅ | ✅ |
| `classes` | ✅ | ✅ | ✅ | ✅ |
| `subjects` | ✅ | ✅ | ✅ | ✅ |
| `curriculum` | ✅ | ✅ | ✅ | ✅ |
| `library` | ✅ | ✅ | ✅ | ✅ |
| `gradesCriteria` | ✅ | ✅ | ✅ | ✅ |
| `lectures` | ✅ | — | — | — |
| `teachers` | ✅ | — | — | — |
| everything else | — | — | — | — |

## 6. What stays exactly the same

- Roles, login screens, forgot-password, mobile app.
- `OWNER` and `SUPERVISOR` («مدير المدرسة»): full access; titles never apply to them.
- Assistants with no title: today's `MANAGER` permissions.
- Teachers and students.
- Owner/supervisor-only actions: managing admins, the permissions page, deleting an academic year, the WhatsApp test message.
- The payment-void rule (recorder same day, or owner).
- «حضوري»: every manager and supervisor checks in and out by location, with or without a title.

**One deliberate change:** assistants lose the «حضور الإداريين والمشرفين» management page unless a title grants `staffAttendance`, and nobody can enter, edit or delete their own attendance by hand.

## 7. Known limitations

- **Permission changes apply at next login**, as today. Optional follow-up: a `permissionsVersion` counter on the account, bumped on title edit or assignment, compared by `JwtAuthGuard` to force a re-login.
- **Mobile** keeps showing managers the same screens. A mobile pass that hides sections by permission is a separate follow-up.

## 8. Verification before release

Build on a local copy with seeded data. Create one assistant per template plus one without a title, then:

1. **Menus**: log in as each; the sidebar shows only that title's areas.
2. **Server enforcement**: with each token, call create/update/delete on every area the title *doesn't* grant (students, teachers, classes, financial, expenses…) and confirm 403. Call the areas it *does* grant and confirm success.
3. **No regressions**:
   - A teacher: timetable, attendance, preparation, exams, projects, library.
   - A student.
   - An assistant with no title: every area they have today.
4. **Promoted teacher** (`isManager`) with a title: teacher screens plus the title's areas.
5. **Title lifecycle**: edit a title → re-login picks it up; deleting an assigned title is refused; clearing the assignment → default permissions.
6. **Dashboard**: each limited assistant's home page loads with no error cards.
7. **Tenant isolation**: titles from another school are invisible and unassignable.
8. **Staff attendance**:
   - An assistant with no `staffAttendance` box: «حضوري» works; the management page is hidden; `GET /staff-attendance`, `POST /staff-attendance`, `PATCH`, `DELETE` → 403.
   - An assistant granted read + add + edit: can list and correct a colleague; manual entry, edit or delete on **their own** `staffId` → refused.
   - A supervisor: same refusal on their own record; allowed on others.
   - The owner: allowed on everyone.

## 9. Rollout

0. **Release 0 — staff attendance, now.** The [Staff attendance](#staff-attendance) sub-section plus the edit-dialog fix. Assistants lose the management page; «حضوري» unchanged.
1. **Release A — Phases 1–2.** No visible change. Watch server logs for new 403s from teachers or default managers for a day.
2. **Release B — Phases 3–5.** Titles become available. The school creates titles from the templates, adjusts them, and assigns them. Affected assistants log out and in.

## 10. Risk summary

| Phase | Risk | Why | Mitigation |
|---|---|---|---|
| 0 | Low | One new module's gates, one new key; the only visible change is intended | Role tests in `staff-attendance.spec.ts`; tell schools assistants no longer see the management page |
| 1 | **Medium** | Touches ~18 controllers, some of which teachers and students also call | Endpoint-by-endpoint rule in Phase 1, 403 specs, regression pass per role, released alone |
| 2 | Low | Adds keys; backfill preserves current access | Backfill copies existing values |
| 3 | Low | New collection and an optional field; login unchanged when unset | Token-equality test for untitled accounts |
| 4 | Low | New tab and dropdown; existing screens only relabelled | Manual pass per page with limited tokens |
| 5 | Low | Data only; owner-editable | — |
