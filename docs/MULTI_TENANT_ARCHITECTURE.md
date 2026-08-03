# Nasaq School System → Multi-Tenant SaaS Platform
## Architecture Document (v1.0 — Pre-Implementation)

> Status: **PROPOSAL — NOT YET IMPLEMENTED**. No production code has been changed. This document must be reviewed and approved before any module implementation begins.

---

## 0. Ground Truth Recorded From The Actual Repo

Before designing anything, here is exactly what exists today (verified by reading the source, not assumed):

- **Auth**: single `POST /auth/login` resolves `Admin → Teacher → Student` in that order by trying each model's `findOne`. JWT payload today is `{ sub, email, role }` (see `auth.jwtPayload.d.ts`). `JwtStrategy.validate()` returns `{ userId, email, role }` onto `request.user`. There is **no `schoolId` anywhere** in the payload, the strategy, or any guard.
- **Guards**: `JwtAuthGuard` (passport wrapper), `AbilitiesGuard` (CASL, reads `@CheckAbilities()` metadata, builds ability via `CaslAbilityFactory.defineAbilitiesFor(user)`), `RolesGuard` (financial only, not globally used).
- **CASL**: `CaslAbilityFactory` builds abilities purely from `PermissionsService.getPermissionsByRole(user.role)` — **role only**, no per-user/per-tenant scoping, and no per-user permission overrides (Managers with custom permission sets are structurally impossible today).
- **Permissions**: single global `permissions` collection keyed only by `role` (`ADMIN`/`TEACHER`/`STUDENT`), one document per role, defining CRUD flags per domain (`students`, `teachers`, `classes`, ... `financial`). This is **shared across the entire platform** — there's no concept of "this school's Teacher permissions differ from that school's."
- **Admin**: `admins` collection, `username`+`email` globally unique, `role` hardcoded string default `'ADMIN'`.
- **Students**: `email` and `schoolEmail` are globally unique indexes. Full name is computed via `pre('save')`/`pre('findOneAndUpdate')` hooks.
- **Teachers**: `email` globally unique.
- 15 feature modules registered in `app.module.ts`, all independent, no shared tenant context today.
- Financial domain (`FeeConfig`, `InstallmentPlan`, `StudentFinancialRecord`, discounts, additional fees, bus, trips) is its own module with 6+ schemas — the most schema-dense domain in the system, confirming Section 1's description.

This document's every recommendation is anchored to these exact files/collections/patterns — nothing generic.

---

## 1. High-Level Architecture

### 1.1 New modules and how they sit alongside the existing 15

```
AppModule
├── PlatformModule (NEW) ─────────────── SUPER_ADMIN-only concerns, mounted first
│   ├── PlatformAuthModule        (SUPER_ADMIN login, separate JWT strategy/secret-scope)
│   ├── SchoolsModule             (school CRUD, registration, suspension, slug mgmt)
│   ├── SubscriptionsModule       (plan assignment, status, billing hooks)
│   ├── PlansModule               (subscription plan catalog: Free/Basic/Pro/Enterprise)
│   └── AuditLogsModule           (impersonation trail, manager promotion trail)
│
├── TenancyModule (NEW, foundational, imported by almost everything)
│   ├── TenantContextService      (request-scoped: resolves & exposes current schoolId)
│   ├── @CurrentSchool() decorator
│   ├── TenantGuard               (asserts schoolId present & school active, before Abilities/Roles)
│   └── tenantScopedPlugin        (Mongoose plugin — see §7)
│
├── AuthModule (MODIFIED)
│   ├── school-user login (Owner/Manager/Teacher/Student) → schoolId-bearing JWT
│   └── platform login (SUPER_ADMIN) → schoolId:null JWT, different guard chain
│
├── ManagersModule (NEW)
│   ├── create manager directly
│   ├── promote teacher → manager (adds role/permission, same underlying account)
│   └── demote / permission editing
│
├── PermissionsModule (MODIFIED — becomes per-school + per-user overridable)
│   ├── school-level default permission sets (seeded at registration)
│   └── per-Manager custom permission overrides
│
├── CaslModule (MODIFIED)
│   └── CaslAbilityFactory now builds abilities from (role, schoolId, resolved permissions)
│
├── [15 EXISTING MODULES] (MODIFIED, not rewritten)
│   Students, Teachers, Classes, Subjects, Attendance, Lectures, Exams,
│   GradesCriteria, Projects, Preparation, Library, Financial, Expenses, Admin(→Owner), Tasks
│   → each schema gets `schoolId`; each service call is auto-scoped by the tenant plugin
│
└── DashboardsModule (NEW)
    ├── super-admin aggregate dashboard (cross-school)
    ├── owner dashboard (single-school, built from existing collections)
    └── manager dashboard (same data, filtered by granted permissions)
```

### 1.2 Design principle: "Tenancy is infrastructure, not a feature"

The single most important architectural decision: **tenant scoping must live below the service layer, in the persistence layer**, so that no developer — today or in year 3 of this SaaS — can write a Mongoose query that accidentally skips the `schoolId` filter. Section 7 details the exact mechanism (a global Mongoose plugin + a request-scoped context + a lint-time convention). This directly answers your requirement in Section 2 ("structurally impossible to bypass").

---

## 2. Recommended Folder Structure

```
src/
├── platform/                          # NEW — everything SUPER_ADMIN, zero schoolId
│   ├── platform-admins/
│   │   ├── schemas/platform-admin.schema.ts
│   │   ├── platform-admins.controller.ts
│   │   ├── platform-admins.service.ts
│   │   └── platform-admins.module.ts
│   ├── schools/
│   │   ├── schemas/school.schema.ts
│   │   ├── dto/register-school.dto.ts
│   │   ├── dto/update-school.dto.ts
│   │   ├── schools.controller.ts        # POST /schools/register (public)
│   │   ├── schools.admin.controller.ts  # SUPER_ADMIN school mgmt endpoints
│   │   ├── schools.service.ts
│   │   └── schools.module.ts
│   ├── subscriptions/
│   │   ├── schemas/subscription.schema.ts
│   │   ├── subscriptions.controller.ts
│   │   ├── subscriptions.service.ts
│   │   └── subscriptions.module.ts
│   ├── plans/
│   │   ├── schemas/plan.schema.ts
│   │   ├── plans.controller.ts
│   │   ├── plans.service.ts
│   │   └── plans.module.ts
│   └── audit-logs/
│       ├── schemas/audit-log.schema.ts
│       ├── audit-logs.service.ts
│       └── audit-logs.module.ts
│
├── tenancy/                            # NEW — the enforcement core
│   ├── tenant-context.service.ts       # request-scoped provider
│   ├── decorators/current-school.decorator.ts
│   ├── guards/tenant.guard.ts
│   ├── plugins/tenant-scoped.plugin.ts # mongoose schema plugin
│   ├── base/tenant-scoped.repository.ts (optional base class)
│   └── tenancy.module.ts
│
├── managers/                            # NEW
│   ├── managers.controller.ts
│   ├── managers.service.ts
│   ├── managers.module.ts
│   └── dto/
│
├── permissions/                         # MODIFIED (existing folder, extended)
│   ├── schemas/permission.schema.ts     # add schoolId, add userId (override) variant
│   └── ...
│
├── casl/                                # MODIFIED
├── auth/                                # MODIFIED
├── admin/  → becomes "owners" conceptually (see §10.3 decision)
├── students/ teachers/ classes/ subjects/ attendance/ lectures/ exams/
├── grades-criteria/ projects/ preparation/ library/ financial/ expenses/ tasks/
│   (ALL MODIFIED: schema +schoolId, service queries tenant-scoped)
│
└── dashboards/                          # NEW
    ├── super-admin-dashboard.controller.ts
    ├── owner-dashboard.controller.ts
    ├── manager-dashboard.controller.ts
    └── dashboards.module.ts
```

---

## 3. Database Schema Changes (collection by collection)

### 3.1 New: `schools`
```
_id, name, slug (unique idx), logo, phone, email, country, city, address,
timezone, academicYear, subscriptionPlan (ref Plans or enum), subscriptionStatus
(enum: trialing|active|past_due|suspended|cancelled), isActive: boolean,
ownerId (ref Owner/Admin), createdAt, updatedAt
Indexes: { slug: 1 } unique, { isActive: 1 }, { subscriptionStatus: 1 }
```

### 3.2 New: `platformAdmins` (SUPER_ADMIN — completely separate from schools)
```
_id, name, email (unique), password, role: 'SUPER_ADMIN' (fixed),
isActive, lastLoginAt, createdAt, updatedAt
```
No `schoolId` field exists on this collection at all — its complete absence is what the tenant guard checks for.

### 3.3 New: `subscriptions` (or embed into `schools` — recommend separate collection for history)
```
_id, schoolId (unique per active row), planId, status, startDate, endDate,
trialEndsAt, billingCycle, cancelledAt, createdAt, updatedAt
Indexes: { schoolId: 1 }, { status: 1 }
```

### 3.4 New: `plans`
```
_id, name (e.g. Free/Basic/Pro/Enterprise), price, billingCycle,
limits: { maxStudents, maxTeachers, maxStorageMB }, features: string[],
isActive
```

### 3.5 New: `auditLogs`
```
_id, actorType ('SUPER_ADMIN'|'OWNER'|'MANAGER'), actorId, schoolId (nullable
for platform actions), action (e.g. 'MANAGER_CREATED','TEACHER_PROMOTED',
'IMPERSONATION_START','IMPERSONATION_END'), targetId, metadata: Object,
ipAddress, createdAt
Indexes: { schoolId: 1, createdAt: -1 }, { actorId: 1 }
```

### 3.6 Existing collections — required change (uniform pattern)

Every one of the 20 collections listed in your Section 5.2 gets:
```
schoolId: { type: ObjectId, ref: 'School', required: true, index: true }
```
Plus the compound indexes listed in Section 9 below.

### 3.7 `admins` collection → decision (see §10.3 for full reasoning)
**Recommendation: keep the `admins` collection, do not create a new `owners` collection.**
- Add `schoolId: ObjectId` (required for OWNER/MANAGER docs, absent/null conceptually meaningless here — Admin collection is now exclusively school-scoped).
- Add `role: 'OWNER' | 'MANAGER'` (currently hardcoded `'ADMIN'` default — becomes a real enum).
- Add `permissions: string[]` (only meaningful for MANAGER; OWNER implicitly has all).
- Add `promotedFromTeacherId?: ObjectId` (nullable — set when a Manager was created via teacher promotion, for traceability).
- Change unique index: `username` stays globally unique **only if you want cross-school username uniqueness** — recommend changing to `{ schoolId: 1, username: 1 }` compound unique, same for `email` → `{ schoolId: 1, email: 1 }` compound unique.

### 3.8 `students` collection changes
- Add `schoolId` (required, indexed).
- `email` unique index → change from global-unique to compound `{ schoolId: 1, email: 1 }` unique.
- `schoolEmail` unique index → change to `{ schoolId: 1, schoolEmail: 1 }` unique; the generation pattern (wherever it's built — check `students.service.ts` at implementation time) must incorporate `school.slug` instead of a hardcoded domain suffix.
- `name` index stays as-is but becomes non-unique-scoped naturally (it was never unique).

### 3.9 `teachers` collection changes
- Add `schoolId` (required, indexed).
- `email` unique → `{ schoolId: 1, email: 1 }` compound unique.
- Add `isManager: boolean` (default false) and `managerPermissions: string[]` (default []) — this is what "promote to Manager" flips, **without creating a duplicate account**, directly satisfying your requirement in Section 3 (MANAGER option 1).
- Add `role` becomes dynamic: base role stays `'TEACHER'`; a promoted teacher is still fundamentally a Teacher document but `isManager: true` grants elevated abilities. (Alternative considered and rejected: duplicating into `admins` — rejected because it would desynchronize subjectIds/isInCharge/etc. and violate "does not duplicate the account" requirement.)

### 3.10 Remaining 17 collections (`classes`, `subjects`, `attendance`, `lectures`, `exams`, `gradesCriteria`, `projects`, `preparation`, `library`, `feeConfigs`, `installmentPlans`, `studentFinancialRecords`, discount templates, `additionalFees`, bus enrollment, `trips`, `expenseCategories`, `expenses`)
- Each gets `schoolId: { type: ObjectId, ref: 'School', required: true, index: true }`.
- `feeConfigs` unique index on `academicYearId` → compound `{ schoolId: 1, academicYearId: 1 }` unique (explicitly called out in your Section 5.3 — confirmed correct).
- Any other single-field unique index that was implicitly "global" (audit every schema file at implementation time — the two identified above are confirmed; others must be individually checked module-by-module during implementation, e.g. class names, subject codes if any).

### 3.11 `permissions` collection changes
- Add `schoolId: ObjectId` (nullable — null/absent means "platform default template", present means "this school's override for this role").
- Add optional `userId: ObjectId` (nullable — when set, this is a **per-Manager custom override**, not a role-level default). This is the structural mechanism for "Owner can grant/revoke individual permissions per Manager" (your Section 3/8 requirement) without inventing a new collection.
- Resolution order when computing a user's effective permissions: `userId override → schoolId+role override → global role default (seed template)`.

---

## 4. Role Hierarchy Diagram

```
                         ┌───────────────┐
                         │  SUPER_ADMIN  │   platformAdmins collection
                         │ (no schoolId) │   platform-level permissions only
                         └──────┬────────┘
                                │ manages (cross-tenant, via SchoolsModule)
                                ▼
                    ┌───────────────────────┐
                    │        School          │  (tenant boundary)
                    └───────────┬───────────┘
                                 │
                 ┌───────────────┴────────────────┐
                 ▼                                 ▼
          ┌─────────────┐                  ┌───────────────┐
          │    OWNER     │  1-per-school    │   MANAGER      │  0..N per school
          │ (admins coll,│  full control    │ (admins OR     │  Owner-granted
          │ role=OWNER)  │  within tenant   │  teachers coll,│  permission subset
          └──────┬───────┘                  │  isManager=true│
                 │ creates/manages          └───────┬────────┘
                 ├─────────────────┬─────────────────┤ (same permissions engine)
                 ▼                 ▼                 ▼
          ┌────────────┐   ┌─────────────┐   (Manager can also manage Teachers/
          │  TEACHER    │   │   STUDENT    │    Students per granted permissions)
          │ (teachers)  │   │  (students)  │
          └────────────┘   └─────────────┘
```

Key invariant enforced structurally (§7): **every arrow below "School" is confined inside that one `schoolId`. There is no path in the code for a query to cross from one School subtree into another.**

---

## 5. Permission System Design

### 5.1 Permission string catalog (school-level, matches your Section 8 exactly)
```
school.students.read / .create / .update / .delete
school.teachers.manage
school.classes.manage
school.subjects.manage
school.attendance.manage
school.lectures.manage
school.exams.manage
school.gradesCriteria.manage
school.projects.manage
school.preparation.manage
school.library.manage
school.financial.manage
school.expenses.manage
school.managers.manage
school.analytics.view
school.settings.manage
```

### 5.2 Platform-level permission set (separate namespace, SUPER_ADMIN only)
```
platform.schools.manage
platform.subscriptions.manage
platform.plans.manage
platform.analytics.view
platform.impersonation.perform
```

### 5.3 Resolution & storage
- **OWNER**: implicit `['*']` (all `school.*` permissions) — never stored explicitly, computed at ability-build time as "all school permissions granted", so future new permission strings automatically apply to Owners without a migration.
- **MANAGER**: explicit array of granted `school.*` strings stored either on the `admins`/`teachers` document (`managerPermissions: string[]`) or in the `permissions` collection with `userId` override — recommend storing directly on the user document (`managerPermissions`) for simplicity/read-speed since it's a small array read on every request via JWT anyway (see §6).
- **TEACHER / STUDENT**: keep today's role-level default template (backward compatible), but now templates are namespaced by `schoolId` so an Owner can eventually customize a Teacher's default permission template per-school too (future-proofing, optional to expose in UI at first).
- Hardcoded guardrails (never permission-editable, enforced in code regardless of granted permissions): Manager cannot delete school, cannot touch subscription/plan, cannot transfer ownership, cannot delete Owner, cannot create Owner. These are enforced by an explicit role check (`role === 'OWNER'`) in the relevant service methods — a permission string would be the wrong tool for an absolute prohibition.

### 5.4 CASL integration
`CaslAbilityFactory.defineAbilitiesFor(user)` changes from `getPermissionsByRole(user.role)` to a resolver that:
1. If `user.role === 'SUPER_ADMIN'` → build platform abilities from platform permission set, subject types are platform subjects (`School`, `Subscription`, `Plan`), completely separate `Subjects` union type.
2. Else → resolve effective school permissions (Owner=all, Manager=stored array, Teacher/Student=template for `user.schoolId`+`role`), then map each permission string to CASL `can(action, subject)` — the existing entity→subject map stays but is now driven by permission **strings**, not the old flat `{read,add,edit,delete}` object (backward-compatible mapping layer can translate old shape to new strings during transition).

---

## 6. Authentication Flow

### 6.1 School-user login (Owner/Manager/Teacher/Student) — `POST /auth/login` (unchanged path)
1. Resolve identifier against `admins` (Owner/Manager), `teachers`, `students` — same cascading lookup as today, but each lookup is inherently global (since email is now school-scoped, a plain email lookup with no `schoolId` could theoretically match rows in multiple schools). **Resolution**: the login must accept the identifier and, since compound-unique emails mean two schools *can* have the same email, disambiguate by also matching on `schoolId` if provided (e.g. via a school-scoped subdomain/slug in the request, or by returning "multiple accounts found, please specify school" if more than one match — decide UX at implementation time; recommend requiring the frontend to pass the resolved `schoolId` or `slug` via a login-time header/body field once the frontend has a school-selection or subdomain step).
2. Once user found and password verified, pull the user's `schoolId`, `role`, resolved `permissions` (array of strings from §5.3).
3. Verify `school.isActive === true` and `subscriptionStatus` is not `suspended/cancelled` — reject login otherwise with a clear "school suspended" message.
4. Issue JWT: `{ sub, email, role, schoolId, permissions }`.

### 6.2 Platform login — `POST /platform/auth/login` (NEW, separate controller/route, ideally separate rate-limit bucket)
1. Looks up `platformAdmins` only — never touches school-scoped collections.
2. JWT payload: `{ sub, email, role: 'SUPER_ADMIN', schoolId: null, permissions: [...platform permission strings] }`.
3. Recommend a **different JWT secret/audience claim** (`aud: 'platform'` vs `aud: 'school'`) so a platform token can never even be structurally accepted by school-scoped guards, and vice versa — this is a second, independent layer of defense beyond just checking `schoolId === null`.

### 6.3 School registration — `POST /schools/register` (NEW, public)
Wrapped in a single Mongo transaction (multi-document ACID via `mongoose.startSession()` + `withTransaction`):
1. Validate uniqueness of `slug` (derived from name, checked/normalized) and `email`.
2. Create `School` doc (`isActive: true`, `subscriptionPlan: 'trial'`/default free plan, `subscriptionStatus: 'trialing'`).
3. Create `Owner` doc in `admins` collection (`role: 'OWNER'`, `schoolId` = new school id, hashed password).
4. Set `school.ownerId`.
5. Seed default `permissions` templates for that `schoolId` (copy of global TEACHER/STUDENT defaults, namespaced).
6. Create default academic year / school settings doc (new lightweight `schoolSettings` collection or embedded on `School` — recommend embedded sub-document on `School` since it's 1:1 and small, avoids a 21st collection).
7. Commit transaction; on any failure, abort — nothing partially created.
8. Sign and return JWT exactly like `/auth/login`'s response shape (owner logged in immediately).
- Idempotency: if `email`/`slug` collision detected pre-transaction, return `409 Conflict` with a clear message — do not silently upsert.
- Rate limiting: apply `@nestjs/throttler` (or existing infra) at `10 requests / hour / IP` on this route specifically (Section 13 requirement).

---

## 7. Authorization Flow — Tenant Scoping End-to-End (the core guarantee)

This is the part that must be "structurally impossible to bypass," so the mechanism is layered, not a single guard:

### Layer 1 — JWT is the only source of truth for `schoolId`
`JwtStrategy.validate()` is modified to attach `schoolId` (and `permissions`) onto `request.user` straight from the verified, signed payload. **No controller, DTO, query param, or header is ever consulted for `schoolId`.** Any `schoolId` appearing in a request body/query is explicitly stripped/ignored by DTO whitelisting (`ValidationPipe({ whitelist: true })` already exists — we just never declare `schoolId` as an accepted DTO field on any write endpoint).

### Layer 2 — `TenantGuard` (new, runs immediately after `JwtAuthGuard`, before `AbilitiesGuard`)
- For school-scoped routes: asserts `request.user.schoolId` exists, is a valid ObjectId, and the referenced `School.isActive === true`. Throws `403` otherwise.
- For platform routes (`@PlatformOnly()` marker decorator): asserts `request.user.schoolId` is `null`/absent AND `role === 'SUPER_ADMIN'`. This dual assertion is what makes cross-realm token reuse impossible even if someone forges a request — a school JWT literally cannot satisfy a platform route's guard, and a platform JWT cannot satisfy a school route's guard.

### Layer 3 — `TenantContextService` (request-scoped provider, `Scope.REQUEST`)
- Populated by `TenantGuard` (or an interceptor right after it) with the verified `schoolId`.
- Exposed via `@CurrentSchool()` param decorator for the rare cases a service explicitly needs it (e.g. building a new document that needs `schoolId` set on create).

### Layer 4 — `tenantScopedPlugin` (Mongoose schema plugin) — **the structural guarantee**
This is the mechanism that makes it "impossible to forget," not just "conventionally applied":
- A single Mongoose plugin is `schema.plugin(tenantScopedPlugin)`'d onto every one of the 20 tenant-scoped schemas at schema-definition time (one line per schema file — small, auditable diff).
- The plugin hooks Mongoose's query middleware (`pre('find')`, `pre('findOne')`, `pre('findOneAndUpdate')`, `pre('updateMany')`, `pre('countDocuments')`, `pre('aggregate')`, `pre('save')` for creates, `pre('deleteOne')`/`pre('deleteMany')`) and:
  - On every **read/update/delete query**, if the query does not already contain a `schoolId` clause, it injects `schoolId = TenantContextService.currentSchoolId()` (obtained via a static/module-level accessor backed by Node's `AsyncLocalStorage`, since Mongoose middleware is not a NestJS injection context — this is the standard, proven pattern for "ambient request context in Mongoose hooks").
  - If a query **explicitly tries to set a different `schoolId`** than the current tenant's (e.g. malicious `$set: { schoolId: otherId }`), the plugin strips/rejects that mutation.
  - On every **create/save**, if `schoolId` is not already set on the document, the plugin auto-assigns it from the current tenant context. A document being saved with a foreign `schoolId` while a different tenant context is active throws.
  - For `SUPER_ADMIN`/platform context (no schoolId in `AsyncLocalStorage`), the plugin **requires an explicit opt-in flag** (e.g. `Model.find().setOptions({ skipTenantScope: true })`) to run cross-tenant queries — used only by `DashboardsModule`'s super-admin aggregation and by the impersonation flow, both of which are themselves gated by `@PlatformOnly()`/audit-logged.
- Practically, this means a developer six months from now adding a brand-new `GET /classes/:id` handler **cannot** accidentally leak cross-tenant data even if they write `this.classModel.findById(id)` with zero awareness of tenancy — the plugin injects the filter underneath them.

### Layer 5 — CASL abilities (role + permission, orthogonal to tenancy)
Once Layer 4 guarantees "you can only ever see rows in your own school," CASL/`AbilitiesGuard` continues to answer the separate question "given you're in your school, are you allowed to do *this action* on *this subject type*." Tenancy and permissions remain cleanly separated concerns — tenancy answers "which rows," permissions answer "which actions."

### Layer 6 — Ownership re-validation on single-resource mutations
Even with Layer 4 auto-filtering, every `findById`/`findOneAndUpdate`-by-`_id` style call must resolve through a model that already has the tenant plugin applied — meaning a request for `PATCH /students/:id` where `:id` belongs to School B, issued by a School A JWT, will simply **404** (the tenant-scoped query `{ _id: id, schoolId: schoolA }` matches nothing), not `403` — this is intentionally indistinguishable from "resource doesn't exist" to avoid leaking existence information across tenants (defense against enumeration/IDOR probing).

### 7.1 Concrete IDOR test checklist (to be turned into real automated tests during implementation)
- [ ] Login as School A Owner, GET `/students/:idBelongingToSchoolB` → expect `404`.
- [ ] Login as School A Teacher, PATCH `/exams/:idBelongingToSchoolB` → expect `404`.
- [ ] Login as School A Owner, attempt `POST /students` with body containing `schoolId: <schoolB>` → verify created doc's actual `schoolId` is School A's (field silently ignored).
- [ ] Login as School A Manager without `school.financial.manage`, GET `/financial/records` → expect `403` (permission layer), even for School A's own data.
- [ ] Attempt reusing a School A JWT against any `@PlatformOnly()` route → expect `403` from `TenantGuard` Layer 2.
- [ ] Attempt reusing a platform JWT (`schoolId: null`) against any school-scoped route → expect `403` from `TenantGuard` Layer 2.
- [ ] Aggregate/report endpoints (dashboards, financial summaries) checked individually — aggregation pipelines must have `$match: { schoolId }` as the **first stage**, verified per-endpoint since the plugin's query-level injection does not automatically cover raw `aggregate()` calls without the explicit hook in Layer 4 — flagged as a manual audit item per module during implementation.

---

## 8. Migration Strategy (concrete answer to your Section 10)

### 8.1 Sequence (safe, reversible, zero-downtime-oriented)

**Step 0 — Preparation**
- Full mongodump backup of the production database. Non-negotiable, first action, before writing any migration script.
- Deploy the new schema fields as **optional** (`required: false` at first) so old code paths don't break while the migration script runs — flip to `required: true` only after backfill is verified.

**Step 1 — Create the default school**
- Script creates one `School` document representing the current live school (name/email/etc. either from real known values you provide, or placeholder values you edit post-migration). Capture its `_id` as `DEFAULT_SCHOOL_ID`.

**Step 2 — Backfill `schoolId` on all 20 collections**
- For each collection: `db.<collection>.updateMany({ schoolId: { $exists: false } }, { $set: { schoolId: DEFAULT_SCHOOL_ID } })`.
- Run collection-by-collection, logging count matched/modified for each, so partial failure is easy to diagnose and resume (script is idempotent — reruns safely skip already-backfilled docs due to the `$exists: false` filter).

**Step 3 — Convert existing Admin(s) into Owner**
- **Decision: keep `admins` collection** (justification in §3.7/§10.3): update existing admin doc(s) — `role: 'OWNER'`, `schoolId: DEFAULT_SCHOOL_ID`. Set `School.ownerId` to that admin's `_id`.
- If multiple existing admin accounts exist, pick one as Owner (the "main" one you designate) and convert the rest to `MANAGER` with full permission set (safe default preserving current access level, since today all Admins had identical unrestricted access).

**Step 4 — Create your personal `platformAdmins` record**
- Independent, brand-new collection, one document, created manually/via seed script — completely disconnected from `DEFAULT_SCHOOL_ID` or any school data.

**Step 5 — Resolve pre-existing "global unique" conflicts before enabling compound-unique indexes**
- Since there's currently only one school, every existing global-unique field (student email, teacher email, admin email/username, feeConfig academicYear) is trivially still unique once `schoolId` is uniform — no actual conflicts expected in a single-school migration. Still, run a verification query per field (`aggregate` + `$group` + `$match: { count: { $gt: 1 } }`) to confirm zero duplicates before adding indexes, as a safety check.

**Step 6 — Add new indexes AFTER backfill (per your explicit requirement)**
- Add all compound `{ schoolId: 1, ... }` indexes (full list in §9) using `createIndex` with `{ background: true }` (or online index builds, default in modern MongoDB) to avoid blocking reads/writes on the live collections.
- Convert old global-unique indexes to the new compound-unique versions: create the new compound index first, verify it built successfully, **then** drop the old single-field unique index — never drop-before-create, to avoid a window with no uniqueness constraint at all.

**Step 7 — Flip `schoolId` to `required: true` in schemas**
- Only after Step 2/6 verified complete across all environments (staging first, then production), deploy the code change making `schoolId` a mandatory field going forward.

**Step 8 — Enable `TenantGuard` + `tenantScopedPlugin` in production**
- Deploy the tenancy enforcement layer only after the above data-level steps are confirmed — enabling it before backfill would break every existing query (since it would inject a filter on a field that doesn't exist yet on old docs), so **order matters strictly**: data migration completes fully before enforcement code goes live.

### 8.2 Rollback plan
- Because Steps 2/3 are additive (`$set`, not destructive) and Step 6 old-index-drop is the only destructive step, rollback is straightforward at each stage:
  - Before Step 6's index drop: simply revert code deploy; old code ignores the new `schoolId` field harmlessly, system behaves exactly as before.
  - After Step 6: restore the dropped single-field unique index from the pre-migration mongodump if a rollback is truly needed (rare — recommend keeping both indexes side-by-side for one release cycle before dropping the old one, at the cost of one extra index temporarily).
  - Full nuclear option: restore the Step-0 mongodump entirely — this is why Step 0 is mandatory and must be verified restorable (test-restore to a scratch DB) before proceeding.
- Keep the migration script's per-collection before/after document counts logged to a file — this is your audit trail proving nothing was silently dropped.

### 8.3 Decision: `admins` collection reused, not replaced (justification)
Creating a separate `owners` collection was considered and **rejected** because:
1. It would require a second migration (copy+delete) instead of an in-place update — higher risk for zero benefit.
2. `OWNER`/`MANAGER` are naturally "the same kind of account" (an administrative staff account with a permission level) — modeling them as one collection with a `role` enum matches how `TEACHER`+`isManager` is already handled for the "promote a teacher" path, keeping the mental model consistent: **role is a property of an account, not a different collection**.
3. Any existing code/reports referencing `admins` by collection name keeps working without a rename.

---

## 9. MongoDB Indexing Strategy (concrete list)

```
schools:                    { slug: 1 } unique
                             { isActive: 1 }
                             { subscriptionStatus: 1 }

platformAdmins:             { email: 1 } unique

admins (Owner/Manager):     { schoolId: 1, role: 1 }
                             { schoolId: 1, email: 1 } unique
                             { schoolId: 1, username: 1 } unique

students:                   { schoolId: 1, email: 1 } unique
                             { schoolId: 1, schoolEmail: 1 } unique
                             { schoolId: 1, classId: 1 }
                             { schoolId: 1, createdAt: -1 }
                             { schoolId: 1, isActive: 1 }

teachers:                   { schoolId: 1, email: 1 } unique
                             { schoolId: 1, isManager: 1 }
                             { schoolId: 1, subjectIds: 1 }

classes:                    { schoolId: 1, createdAt: -1 }
                             { schoolId: 1, teacherInChargeId: 1 }

subjects:                   { schoolId: 1, classIds: 1 }

attendance:                 { schoolId: 1, date: 1 }
                             { schoolId: 1, classId: 1, date: 1 }
                             { schoolId: 1, studentId: 1, date: 1 }

lectures:                   { schoolId: 1, classId: 1, day: 1, slot: 1 }
                             { schoolId: 1, teacherId: 1 }

exams:                      { schoolId: 1, classId: 1 }
                             { schoolId: 1, subjectId: 1 }
                             { schoolId: 1, createdAt: -1 }

gradesCriteria:              { schoolId: 1, subjectId: 1, academicYear: 1 }

projects:                    { schoolId: 1, classId: 1 }
                              { schoolId: 1, createdAt: -1 }

preparation:                  { schoolId: 1, lectureId: 1 }

library:                      { schoolId: 1, subjectId: 1 }

feeConfigs:                   { schoolId: 1, academicYearId: 1 } unique

installmentPlans:             { schoolId: 1, createdAt: -1 }

studentFinancialRecords:      { schoolId: 1, studentId: 1 }
                               { schoolId: 1, academicYear: 1 }

discounts / additionalFees:   { schoolId: 1, isActive: 1 }

bus enrollment / trips:       { schoolId: 1, studentId: 1 }
                               { schoolId: 1, date: 1 }

expenseCategories:            { schoolId: 1, name: 1 }

expenses:                     { schoolId: 1, categoryId: 1 }
                               { schoolId: 1, date: 1 }

auditLogs:                    { schoolId: 1, createdAt: -1 }
                               { actorId: 1, createdAt: -1 }

subscriptions:                 { schoolId: 1 } (current active row)
                                { status: 1 }
```

General rule applied throughout: **`schoolId` is always the first field in every compound index** on tenant-scoped collections, since it is the most selective, universally-applied filter (MongoDB compound index prefix rule — this also lets the same index serve pure `{schoolId}` queries too, without needing a redundant single-field index).

---

## 10. API Changes — Full List (new/changed)

### New public
- `POST /schools/register` (rate-limited)

### New — Managers
- `POST /managers` (Owner only)
- `PATCH /managers/promote/:teacherId` (Owner only)
- `PATCH /managers/:id/permissions` (Owner only — grant/revoke permission strings)
- `DELETE /managers/:id` (Owner only, demote/deactivate)

### New — Platform (SUPER_ADMIN)
- `POST /platform/auth/login`
- `GET /platform/schools`, `GET /platform/schools/:id`
- `PATCH /platform/schools/:id/suspend`, `PATCH /platform/schools/:id/activate`
- `DELETE /platform/schools/:id`
- `POST /platform/schools/:id/impersonate` (audit-logged, time-boxed impersonation token)
- `GET /platform/plans`, `POST /platform/plans`, `PATCH /platform/plans/:id`
- `GET /platform/subscriptions`, `PATCH /platform/subscriptions/:schoolId`
- `GET /platform/analytics` (cross-school aggregate)
- `GET /platform/audit-logs`

### New — Settings / Dashboards
- `GET /schools/me/settings`, `PATCH /schools/me/settings` (Owner/Manager)
- `GET /dashboards/owner`
- `GET /dashboards/manager`
- `GET /dashboards/super-admin`

### Changed — implicit only (contract shape preserved)
All existing endpoints across the 15 modules keep the same request/response shape. The only behavioral change is implicit tenant scoping (a School A user simply never sees School B rows — no new fields added to responses, no required new request params). **Flagged exceptions where the contract must change:**
- `POST /auth/login`: response gains `schoolId` inside the `user` object (additive, non-breaking for clients that ignore unknown fields) and now `permissions` is an array of strings, not the old `{students:{read,add,edit,delete},...}` object — **this is a breaking shape change for any client currently parsing that permissions object**, must be coordinated with frontend.
- Any endpoint accepting a body/query `schoolId` today (verify at implementation time — none identified in the modules read so far) must have that field removed from its DTO.

---

## 11. Swagger Changes

- Add a global note in `main.ts` Swagger setup: "`schoolId` is derived server-side from the authenticated JWT and is never accepted as a request parameter on any endpoint."
- Every DTO with `@ApiProperty()` fields must NOT declare `schoolId` — its absence is itself the documentation.
- New `@ApiTags('Platform - Schools')`, `@ApiTags('Platform - Subscriptions')`, `@ApiTags('Managers')`, `@ApiTags('Dashboards')` groups.
- `@ApiBearerAuth()` split into two named schemes if feasible (`school-jwt`, `platform-jwt`) so Swagger UI testers understand the two token realms are not interchangeable.

---

## 12. Security Recommendations Specific to Financial & Exams

**Financial** (money — highest blast radius):
- Every financial mutation (`fee-config`, `installment-plan`, `discount`, `additional-fee`, `financial-record`, bus/trip enrollment) must re-verify the referenced `studentId`/`classId` belongs to the **same tenant** as the acting user even after the tenant plugin filters the primary query — because these schemas reference other schemas by ID (e.g. a financial record referencing a `studentId`), a cross-tenant reference could otherwise be attached (e.g. School A Owner assigning a fee record to a `studentId` that happens to belong to School B, if that ID is guessable/enumerable). Add explicit "does this referenced ID's document also have my `schoolId`" checks in the service layer for every FK-style reference, even though the tenant plugin's own `save` hook helps, cross-collection FK integrity is not something a single-collection plugin can fully guarantee — requires manual service-level validation.
- Discounts/installment plan changes should be audit-logged (who changed a student's fee amount and when) — extend `auditLogs` usage beyond just Manager/impersonation actions into financial mutations, given real money is involved.

**Exams**:
- Already CASL-protected; ensure grading endpoints (`startExam`/`grade` flow) validate that the `examId`, `studentId`, and the grading `teacherId` all resolve to the same `schoolId` — a Teacher from School A must never be able to grade (or even view) an exam belonging to School B even if they somehow obtain a valid exam ID.
- Exam questions/answers are sensitive pre-exam — ensure `schoolId` scoping applies equally to `GET` (read) as to write, since leaking another school's exam questions is an academic-integrity issue, not just a data-isolation one.

**General**:
- `SUPER_ADMIN` impersonation must issue a **separate, clearly-flagged, short-lived token** (`impersonating: true`, `impersonatedBy: <superAdminId>`) rather than silently minting a normal Owner token — so every action taken during impersonation is distinguishable in `auditLogs`, and the impersonation session has its own expiry independent of normal session length.

---

## 13. Performance Recommendations

- The `AsyncLocalStorage`-based tenant context (Layer 4, §7) has negligible overhead (~microseconds) compared to the Mongo round-trip itself — not a bottleneck.
- Dashboard aggregation queries (Owner/Manager/SUPER_ADMIN) should use MongoDB aggregation pipelines with `$match: { schoolId }` as the first stage always, and should be cached (short TTL, e.g. Redis 60s) since dashboards are read-heavy and don't need real-time precision.
- Watch collection growth on `attendance` and `auditLogs` — these grow unboundedly per school per day; plan for TTL indexes or periodic archival on `auditLogs` (e.g. keep 1 year hot, archive older) once volume is significant.
- Financial reports spanning date ranges should keep `{ schoolId: 1, date: 1 }` compound indexes (already in §9) to keep report queries index-only where possible.

---

## 14. SaaS Best Practices Relevant to School-Management Platforms

- **Trial-to-paid conversion**: default new schools to a `trialing` status with a plan limit (e.g. max 50 students) enforced at the service layer on student-creation — ties directly into the `plans.limits` schema field already proposed.
- **Soft-delete over hard-delete for Schools**: `SUPER_ADMIN` "delete school" should default to `isActive: false` + a `deletedAt` timestamp, with actual data purge as a separate, deliberate, delayed operation (grace period) — schools hold irreplaceable academic records (grades, attendance history) that regulatory/parental disputes may require you to produce even after a school cancels.
- **Per-school academic year rollover**: since `academicYear` is already a field across Students/Financial/GradesCriteria, plan a first-class "start new academic year" operation per school (archives/promotes classes) — not required for the multi-tenancy conversion itself, but worth flagging as a natural next feature once tenancy exists.
- **Data export**: give Owners a self-service data export (GDPR/local-regulation friendly) — easy to add once everything is cleanly `schoolId`-scoped (a single `{schoolId}` filter across 20 collections is now trivial to dump).
- **Usage-based plan enforcement**: `plans.limits` (`maxStudents`, `maxTeachers`, `maxStorageMB`) should be checked at the relevant creation endpoints (`POST /students`, `POST /teachers`, file uploads in Projects/Library/Preparation) — return a clear `402 Payment Required`-style error when a plan limit is hit, guiding upsell.

---

## 15. Future Scalability Recommendation (1,000+ schools)

**Recommendation: stay on a single shared database with `schoolId`-scoped collections (the model this whole document builds), do NOT move to per-tenant databases, at least through the 1,000-school mark — and likely well beyond.**

Justification for your specific case:
1. **Operational simplicity dominates at this stage.** Per-tenant databases (or per-tenant clusters) multiply operational burden linearly with schools: backups, migrations, monitoring, connection pool exhaustion (MongoDB has practical limits on simultaneous DB connections per cluster) all become O(n) problems. A shared DB with proper indexing is O(1) operationally.
2. **A single school's data volume is modest.** Even a large school (2,000 students × attendance × exams × financial records over years) is a few million documents — trivial for MongoDB with proper `{schoolId, ...}` compound indexes. 1,000 schools × a few million docs each is billions of documents total, which MongoDB handles fine in a well-sharded shared collection — this is a **sharding-by-`schoolId`** problem, not a **separate-database** problem.
3. **When you do need to scale past a single replica set**, the correct next step is **MongoDB native sharding using `schoolId` as (part of) the shard key** — not per-tenant databases. This keeps the exact same query/index patterns already designed in this document; you just add `sh.shardCollection(...)` with a shard key like `{ schoolId: 1, _id: 1 }` per collection once a single replica set's storage/IOPS becomes the bottleneck. Because every query in this architecture already includes `schoolId` as the first filter (structurally enforced by the tenant plugin), **every query is already shard-key-aligned** — meaning the sharding migration, when eventually needed, requires zero query-pattern changes, only infrastructure changes. This is the direct payoff of doing tenancy "right" now.
4. **Per-tenant DB would only become justified** if you later need hard regulatory data-residency guarantees per customer (e.g. "this specific enterprise school's data must physically live in a specific country's datacenter") — a valid enterprise-tier feature, but recommend deferring it to a specific paid "dedicated" plan tier offered only to large enterprise customers who need it, rather than the default architecture for all 1,000+ schools.

---

## 16. Implementation Order (confirmed, matches your Section 14 request)

```
1. SchoolsModule + Auth changes + CASL foundation (JWT payload, guards, plugin skeleton)
2. Migration/backfill scripts (staging first, then production)
3. Admin → Owner conversion (schema + role enum + migration)
4. ManagersModule + Permissions overhaul
5. Students
6. Teachers
7. Classes
8. Subjects
9. Attendance
10. Lectures
11. Exams
12. GradesCriteria
13. Projects
14. Preparation
15. Library
16. Financial (all sub-modules: FeeConfig, InstallmentPlan, Discounts, AdditionalFees, Bus, Trips, FinancialRecords)
17. Expenses
18. Dashboards
```

For each module's turn, the deliverable will be a **diff-style review** (schema diff, service diff, controller diff) against current behavior — not a rewrite — exactly as requested.

---

## Open Questions For You Before Implementation Begins

1. **Email uniqueness scope** (§3.8/§3.9/§10 flagged this): confirm compound-unique-per-school (same email usable across different schools) is the intended behavior, vs. keeping email globally unique across the whole platform. This affects the login-disambiguation logic in §6.1.
2. **Login disambiguation UX** (§6.1): should the frontend pass a school slug/subdomain at login time, or should the backend return a "multiple schools found for this email, please choose" response? This is a product decision, not just technical.
3. **Owner/Manager storage**: confirm you're comfortable with reusing `admins` (role enum) rather than a new `owners` collection, per §3.7/§8.3's justification.
4. **School settings**: confirm embedding settings on the `School` document (vs. a separate `schoolSettings` collection) is acceptable — recommended for simplicity given it's strictly 1:1.
5. **Impersonation UI**: do you want impersonation to produce a fully separate "read-only support view" or a full read-write Owner-equivalent session (audit-logged either way)? Affects the impersonation token design in §12.

---

*End of architecture document. Awaiting your review/approval before any implementation begins.*
