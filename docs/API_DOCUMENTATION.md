# Nasaq School System — Complete API Documentation

> **Version:** 2.0 (Multi-Tenant SaaS — Academic System v2)  
> **Framework:** NestJS + Mongoose (MongoDB)  
> **Live Swagger UI:** `http://localhost:3000/api/docs`  
> **Base URL:** `http://localhost:3000`  
> **Last Updated:** 2026-07-30

---

## Table of Contents

1. [Architecture & Scoping Principles](#1-architecture--scoping-principles)
2. [Global Configuration](#2-global-configuration)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Database Schemas Dictionary](#4-database-schemas-dictionary)
5. [Complete API Endpoints Reference](#5-complete-api-endpoints-reference)
   - [5.1 Platform Administration & School Registration](#51-platform-administration--school-registration)
   - [5.2 Authentication (Login Endpoints)](#52-authentication-login-endpoints)
   - [5.3 Managers Management (OWNER Only)](#53-managers-management-owner-only)
   - [5.4 Permissions & Dynamic Role Controls](#54-permissions--dynamic-role-controls)
   - [5.5 Dashboards & Analytics](#55-dashboards--analytics)
   - [5.6 Admin User Management](#56-admin-user-management)
   - [5.7 Academic Years & Start New Year Wizard](#57-academic-years--start-new-year-wizard)
   - [5.8 Terms](#58-terms)
   - [5.9 Stages](#59-stages)
   - [5.10 Grade Levels](#510-grade-levels)
   - [5.11 Classes](#511-classes)
   - [5.12 Enrollments & Bulk Student Promotion](#512-enrollments--bulk-student-promotion)
   - [5.13 Subject Offerings](#513-subject-offerings)
   - [5.14 Teacher Assignments](#514-teacher-assignments)
   - [5.15 Subjects Catalog](#515-subjects-catalog)
   - [5.16 Teachers](#516-teachers)
   - [5.17 Students & Portal OTP Setup](#517-students--portal-otp-setup)
   - [5.18 Attendance](#518-attendance)
   - [5.19 Lectures & Copy Schedule Engine](#519-lectures--copy-schedule-engine)
   - [5.20 Exams & Online Quiz System](#520-exams--online-quiz-system)
   - [5.21 Grades Criteria](#521-grades-criteria)
   - [5.22 Projects & File Submissions](#522-projects--file-submissions)
   - [5.23 Lesson Preparation](#523-lesson-preparation)
   - [5.24 Digital Library](#524-library)
   - [5.25 Financial — Records & Student Ledgers](#525-financial--records--student-ledgers)
   - [5.26 Financial — Fee Configs](#526-financial--fee-configs)
   - [5.27 Financial — Installment Plans](#527-financial--installment-plans)
   - [5.28 Financial — Discounts](#528-financial--discounts)
   - [5.29 Financial — Additional Fees](#530-financial--additional-fees)
   - [5.30 Financial — Bus Subscription Module](#530-financial--bus-subscription-module)
   - [5.31 Financial — Trips Subscription Module](#531-financial--trips-subscription-module)
   - [5.32 Expenses — Categories](#532-expenses--categories)
   - [5.33 Expenses](#533-expenses)
   - [5.34 System Health & Diagnostics](#534-system-health--diagnostics)
6. [Standard Response Envelope](#6-standard-response-envelope)
7. [Environment Variables](#7-environment-variables)

---

## 1. Architecture & Scoping Principles

The Nasaq platform enforces strict data scoping across all collections:

### Scoping Matrix

| Scope | Meaning | Collections |
|---|---|---|
| **Tenant-Scoped** | Created once per school, persists across all academic years | `Stages`, `GradeLevels`, `Subjects`, `Teachers`, `SchoolSettings` |
| **Year-Scoped** | Tied to a specific `academicYearId` | `AcademicYears`, `Terms`, `Classes`, `Enrollments`, `SubjectOfferings`, `TeacherAssignments`, `Lectures`, `FeeConfigs`, `StudentFinancialRecords`, `Exams`, `GradesCriteria`, `Projects`, `Library`, `Expenses` |

---

## 2. Global Configuration

| Setting | Value |
|---|---|
| **Multi-Tenancy** | Server-side scoping via `tenantScopedPlugin`. `schoolId` derived from JWT |
| **Terms Per School** | Configurable per school via `SchoolSettings.termsPerYear` (default: 3) |
| **Validation** | `ValidationPipe` — `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` |
| **Response Format** | Wrapped by global `ResponseInterceptor` |
| **Auth Strategy** | JWT Bearer Token (`Authorization: Bearer <token>`) |

---

## 3. Authentication & Authorization

### Roles & Access Hierarchy

```
SUPER_ADMIN → Platform Super Admin (cross-tenant management & platform analytics)
OWNER       → School Owner (full administrative & financial authority)
MANAGER     → School Manager (administrative & academic control, no financials)
TEACHER     → Teacher (assigned subject offerings, lectures, attendance, exams, projects)
STUDENT     → Student (read-only portal access, exam submission, project upload)
```

### Protection Badges

- 🔓 **Public**: Open endpoint (no JWT header needed).
- 🔐 **Authenticated**: Requires `JwtAuthGuard` (valid bearer token).
- 🛡️ **Protected**: Requires `JwtAuthGuard` + `AbilitiesGuard` / `TenantGuard`.

---

## 4. Database Schemas Dictionary

### 4.1 `academicYears` Collection (Year-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | Document ID |
| `name` | String | ✅ | — | e.g. `"2026/2027"` |
| `startDate` | Date | ✅ | — | |
| `endDate` | Date | ✅ | — | |
| `status` | String | — | `"active"` | Enum: `"active"` \| `"archived"` |
| `setupStep` | String | — | `"setup_terms"` | Step tracker in New Year Wizard |

### 4.2 `terms` Collection (Year-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `academicYearId` | ObjectId → AcademicYear | ✅ | — | Indexed |
| `name` | String | ✅ | — | e.g. `"ترم 1"` |
| `order` | Number | ✅ | — | Dynamic order per tenant |
| `startDate` | Date | ✅ | — | |
| `endDate` | Date | ✅ | — | |
| `status` | String | — | `"upcoming"` | Enum: `"upcoming"` \| `"active"` \| `"closed"` |

### 4.3 `stages` Collection (Tenant-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `name` | String | ✅ | — | e.g. `"الابتدائي"` |
| `order` | Number | ✅ | — | Display order |

### 4.4 `gradeLevels` Collection (Tenant-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `stageId` | ObjectId → Stage | ✅ | — | Indexed |
| `name` | String | ✅ | — | e.g. `"صف أول"` |
| `order` | Number | ✅ | — | Global numeric order across stages used for promotion |

### 4.5 `classes` Collection (Year-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `name` | String | ✅ | — | Pedagogical name, e.g. `"1/1"` |
| `gradeLevelId` | ObjectId → GradeLevel | ✅ | — | Indexed |
| `academicYearId` | ObjectId → AcademicYear | ✅ | — | Indexed |
| `gender` | String | ✅ | — | Enum: `"male"` \| `"female"` \| `"both"` |
| `roomNumber` | String | — | — | Physical room location |
| `maxCapacity` | Number | ✅ | `30` | |
| `teacherInChargeId` | ObjectId → Teacher | — | `null` | |

### 4.6 `enrollments` Collection (Year-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `studentId` | ObjectId → Student | ✅ | — | Indexed |
| `classId` | ObjectId → Class | ✅ | — | Indexed |
| `academicYearId` | ObjectId → AcademicYear | ✅ | — | Indexed |
| `status` | String | — | `"enrolled"` | Enum: `"enrolled"` \| `"promoted"` \| `"retained"` \| `"withdrawn"` \| `"graduated"` |
| `enrolledAt` | Date | — | `Date.now` | |

### 4.7 `subjectOfferings` Collection (Year-Scoped)
| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | Auto | |
| `subjectId` | ObjectId → Subject | ✅ | Indexed |
| `gradeLevelId` | ObjectId → GradeLevel | ✅ | Indexed |
| `termId` | ObjectId → Term | ✅ | Indexed |

### 4.8 `teacherAssignments` Collection (Year-Scoped)
| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | Auto | |
| `teacherId` | ObjectId → Teacher | ✅ | Indexed |
| `subjectOfferingId` | ObjectId → SubjectOffering | ✅ | Indexed |

### 4.9 `lectures` Collection (Schedule — Year-Scoped)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `classId` | ObjectId → Class | ✅ | — | Indexed |
| `subjectOfferingId` | ObjectId → SubjectOffering | ✅ | — | Indexed |
| `termId` | ObjectId → Term | ✅ | — | Indexed |
| `teacherId` | ObjectId → Teacher | ❌ | `null` | Nullable for unassigned lectures |
| `dayOfWeek` | String | ✅ | — | `"Sunday"` – `"Thursday"` |
| `slot` | Number | ✅ | — | Period number (1–10) |

---

## 5. Complete API Endpoints Reference

---

### 5.1 Platform Administration & School Registration

Base path: `/schools` & `/platform/schools`

#### `POST /schools/register` 🔓
Onboards a new school tenant and creates its primary `OWNER` admin account.

**Request Payload (JSON):**
```json
{
  "schoolName": "مدرسة النور الأهلية",
  "slug": "alnoor-school",
  "schoolEmail": "info@alnoor.sa",
  "phone": "0555123456",
  "ownerName": "المهندس فهد العتيبي",
  "ownerUsername": "fahad_owner",
  "ownerEmail": "owner@alnoor.sa",
  "ownerPassword": "OwnerPassword123"
}
```

**Field Specifications (`RegisterSchoolDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `schoolName` | `string` | ✅ | Name of the school |
| `slug` | `string` | ✅ | Lowercase letters, numbers, and hyphens only (`/^[a-z0-9-]+$/`) |
| `schoolEmail` | `string` | ✅ | Valid email format |
| `phone` | `string` | ❌ | School contact phone number |
| `ownerName` | `string` | ✅ | Full name of the owner account |
| `ownerUsername` | `string` | ✅ | Length: 4–20 characters |
| `ownerEmail` | `string` | ✅ | Valid email format |
| `ownerPassword` | `string` | ✅ | Length: 6–100 characters |

#### `GET /platform/schools` 🛡️ (SUPER_ADMIN)
Lists all registered school tenants on the platform. Requires Platform Admin JWT (`x-platform-admin` scope).

#### `GET /platform/schools/:id` 🛡️ (SUPER_ADMIN)
Get detailed tenant profile and settings by ID.

#### `PATCH /platform/schools/:id` 🛡️ (SUPER_ADMIN)
Update school tenant configuration.

**Request Payload (JSON):**
```json
{
  "name": "مدرسة النور الأهلية المحدثة",
  "phone": "0555999888",
  "isActive": true,
  "subscriptionStatus": "active"
}
```

**Field Specifications (`UpdateSchoolDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ❌ | Updated school name |
| `phone` | `string` | ❌ | Updated phone number |
| `isActive` | `boolean` | ❌ | Activation state |
| `subscriptionStatus` | `string` | ❌ | E.g. `"active"`, `"suspended"`, `"trial"` |

#### `PATCH /platform/schools/:id/suspend` 🛡️ (SUPER_ADMIN)
Suspend a school tenant's subscription and block access (sets `isActive: false`, `subscriptionStatus: "suspended"`). Body: none.

#### `PATCH /platform/schools/:id/activate` 🛡️ (SUPER_ADMIN)
Re-activate a suspended school tenant. Body: none.

---

### 5.2 Authentication (Login Endpoints)

#### `POST /auth/login` 🔓
Unified login endpoint for School Users (`OWNER`, `MANAGER`, `TEACHER`, `STUDENT`).

**Request Payload (JSON):**
```json
{
  "identifier": "owner@alnoor.sa",
  "password": "Password123",
  "schoolSlug": "alnoor-school"
}
```

**Field Specifications (`LoginUserDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `identifier` | `string` | ✅ | Email or username (min length: 3) |
| `password` | `string` | ✅ | Password (min length: 6) |
| `schoolSlug` | `string` | ❌ | School slug for login scoping (optional if using `schoolId`) |
| `schoolId` | `string` | ❌ | School MongoDB ID for login scoping (optional) |

**Response (200 OK):**
```json
{
  "statusCode": 200,
  "message": "User logged in successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "6650a1b2c3d4e5f6a7b8c9d1",
      "name": "المهندس فهد العتيبي",
      "email": "owner@alnoor.sa",
      "role": "OWNER",
      "schoolId": "6650a1b2c3d4e5f6a7b8c9d0"
    }
  }
}
```

#### `POST /admin/login` 🔓
Dedicated login endpoint for School Admins / Owners / Managers.

**Request Payload (JSON):**
```json
{
  "identifier": "admin_username",
  "password": "Password123"
}
```

**Field Specifications (`LoginAdminDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `identifier` | `string` | ✅ | Username or email (min length: 3) |
| `password` | `string` | ✅ | Password (min length: 6) |

#### `POST /platform/auth/login` 🔓
Platform Super Admin login endpoint. Uses `LoginUserDto` (`identifier` + `password`).

---

### 5.3 Managers Management (OWNER Only)

Base path: `/managers`

#### `POST /managers` 🛡️
Create a new dedicated manager account.

**Request Payload (JSON):**
```json
{
  "username": "manager_ali",
  "email": "ali.manager@school.com",
  "password": "SecurePassword123",
  "permissions": [
    "school.students.read",
    "school.students.create",
    "school.teachers.read"
  ],
  "role": "MANAGER"
}
```

**Field Specifications (`CreateManagerDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `username` | `string` | ✅ | Length: 4–20 characters |
| `email` | `string` | ✅ | Valid email format |
| `password` | `string` | ✅ | Length: 6–100 characters |
| `permissions` | `string[]` | ✅ | Array of granted permission strings |
| `role` | `string` | ❌ | Enum: `'MANAGER'` \| `'SUPERVISOR'` (default: `'MANAGER'`) |

#### `PATCH /managers/promote/:teacherId` 🛡️
Promote an existing teacher to hold dual Manager privileges. Body: none.

#### `PATCH /managers/demote/:teacherId` 🛡️
Demote a teacher-manager back to standard teacher permissions. Body: none.

#### `PATCH /managers/:id/permissions` 🛡️
Set custom permission overrides array for a manager.

**Request Payload (JSON):**
```json
{
  "permissions": [
    "school.students.read",
    "school.students.create",
    "school.teachers.read",
    "school.classes.read"
  ]
}
```

**Field Specifications (`UpdateManagerPermissionsDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `permissions` | `string[]` | ✅ | Array of permission key strings |

#### `GET /managers` 🛡️
List all administrative manager accounts in the school.

#### `DELETE /managers/:id` 🛡️
Delete a manager account.

---

### 5.4 Permissions & Dynamic Role Controls

Base path: `/permissions`

#### `GET /permissions` 🔐
Get default role permissions for the school (`TEACHER` and `STUDENT`). Requires `OWNER` or `SUPERVISOR` role.

#### `POST /permissions/sync-financial` 🛡️
Sync default financial permissions across role documents. Requires `OWNER` or `SUPERVISOR` role. Body: none.

---

### 5.5 Dashboards & Analytics

Base path: `/dashboards`

#### `GET /dashboards/owner` 🛡️ (OWNER)
Get complete executive financial, academic, and administrative analytics.

#### `GET /dashboards/manager` 🛡️ (MANAGER)
Get manager dashboard filtered by granted permissions.

#### `GET /dashboards/super-admin` 🛡️ (SUPER_ADMIN)
Get cross-tenant platform overview analytics.

---

### 5.6 Admin User Management

Base path: `/admin`

#### `POST /admin` 🔐
Create a new admin user profile.

**Request Payload (JSON):**
```json
{
  "username": "school_admin",
  "email": "admin@school.com",
  "password": "AdminPassword123"
}
```

**Field Specifications (`CreateAdminDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `username` | `string` | ✅ | Min length: 3 |
| `email` | `string` | ✅ | Valid email format |
| `password` | `string` | ✅ | Min length: 6 |

#### `GET /admin` 🔐
List all admin accounts in the tenant.

#### `GET /admin/:id` 🔐
Get admin profile by ID.

#### `PATCH /admin/:id` 🔐
Update admin profile details. Accepts partial fields from `CreateAdminDto`.

#### `DELETE /admin/:id` 🔐
Delete an admin account.

---

### 5.7 Academic Years & Start New Year Wizard

Base path: `/academic-years`

#### `POST /academic-years` 🔐
Create a new academic year (archives the current active year).

**Request Payload (JSON):**
```json
{
  "name": "2027/2028",
  "startDate": "2027-09-01",
  "endDate": "2028-05-15"
}
```

**Field Specifications (`CreateAcademicYearDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `name` | `string` | ✅ | Academic year label (e.g. `"2027/2028"`) |
| `startDate` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |
| `endDate` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |

#### `GET /academic-years` 🔐
List all academic years for the tenant.

#### `GET /academic-years/active` 🔐
Get the currently active academic year.

#### `GET /academic-years/:id` 🔐
Get academic year details.

#### `PATCH /academic-years/:id` 🔐
Update academic year details. Accepts partial fields from `CreateAcademicYearDto`.

#### `PATCH /academic-years/:id/setup-step` 🔐
Update setup wizard progress step.

**Request Payload (JSON):**
```json
{
  "step": 2
}
```

**Field Specifications:**
| Field | Type | Required | Description |
|---|---|---|---|
| `step` | `number` | ✅ | Wizard step number (1–7) |

---

### 5.8 Terms

Base path: `/terms`

#### `POST /terms` 🔐
Create a single term.

**Request Payload (JSON):**
```json
{
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d0",
  "name": "ترم 1",
  "order": 1,
  "startDate": "2027-09-01",
  "endDate": "2027-11-15"
}
```

**Field Specifications (`CreateTermDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `academicYearId` | `string` | ✅ | Target Academic Year MongoID |
| `name` | `string` | ✅ | Name of the term (e.g. `"ترم 1"`) |
| `order` | `number` | ✅ | Term sequence order (min: 1) |
| `startDate` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |
| `endDate` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |

#### `POST /terms/bulk` or `POST /terms/bulk/:academicYearId` 🔐
Create bulk terms for an academic year. Accepts `academicYearId` in URL or body.

**Request Payload (JSON):**
```json
{
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d0",
  "terms": [
    { "name": "ترم 1", "order": 1, "startDate": "2027-09-01", "endDate": "2027-11-15" },
    { "name": "ترم 2", "order": 2, "startDate": "2027-11-29", "endDate": "2028-02-15" },
    { "name": "ترم 3", "order": 3, "startDate": "2028-02-22", "endDate": "2028-05-15" }
  ]
}
```

#### `POST /terms/copy-from/:targetYearId/:sourceYearId` 🔐
Copy term names & structure from a previous academic year. Body: optional `{ termOverrides: [...] }`.

#### `GET /terms/by-year/:academicYearId` 🔐
List terms for a specific academic year.

#### `GET /terms/:id` 🔐
Get term details.

#### `PATCH /terms/:id` 🔐
Update term details.

**Request Payload (JSON):**
```json
{
  "name": "ترم 1 معدل",
  "order": 1,
  "startDate": "2027-09-05",
  "endDate": "2027-11-20",
  "status": "active"
}
```

**Field Specifications (`UpdateTermDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ❌ | Updated term name |
| `order` | `number` | ❌ | Updated order (min: 1) |
| `startDate` | `string` | ❌ | ISO Date String |
| `endDate` | `string` | ❌ | ISO Date String |
| `status` | `string` | ❌ | Enum: `'upcoming'` \| `'active'` \| `'closed'` |

#### `DELETE /terms/:id` 🔐
Delete a term.

---

### 5.9 Stages

Base path: `/stages`

#### `POST /stages` 🔐
Create a tenant-scoped stage (e.g., "الابتدائي").

**Request Payload (JSON):**
```json
{
  "name": "المرحلة الابتدائية",
  "order": 1
}
```

**Field Specifications (`CreateStageDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `name` | `string` | ✅ | Stage name |
| `order` | `number` | ✅ | Display order (min: 1) |

#### `GET /stages` 🔐
List all tenant stages sorted by order.

#### `GET /stages/:id` 🔐
Get stage details.

#### `PATCH /stages/:id` 🔐
Update stage name or order. Accepts partial fields from `CreateStageDto`.

#### `DELETE /stages/:id` 🔐
Delete a stage.

---

### 5.10 Grade Levels

Base path: `/grade-levels`

#### `POST /grade-levels` 🔐
Create a grade level linked to a stage.

**Request Payload (JSON):**
```json
{
  "stageId": "6650a1b2c3d4e5f6a7b8c9d0",
  "name": "الصف الأول الابتدائي",
  "order": 1
}
```

**Field Specifications (`CreateGradeLevelDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `stageId` | `string` | ✅ | Parent Stage MongoID |
| `name` | `string` | ✅ | Grade level name |
| `order` | `number` | ✅ | Global progression numeric order across all stages (min: 1) |

#### `GET /grade-levels` 🔐
List all grade levels sorted by global progression order (optionally filtered by `Query: stageId`).

#### `GET /grade-levels/by-stage/:stageId` 🔐
Get grade levels belonging to a specific stage.

#### `GET /grade-levels/:id` 🔐
Get grade level details.

#### `PATCH /grade-levels/:id` 🔐
Update grade level. Accepts partial fields from `CreateGradeLevelDto`.

#### `DELETE /grade-levels/:id` 🔐
Delete a grade level.

---

### 5.11 Classes

Base path: `/classes`

#### `POST /classes` 🔐
Create a classroom section under a grade level and academic year.

**Request Payload (JSON):**
```json
{
  "name": "1/1",
  "gradeLevelId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "gender": "male",
  "teacherInChargeId": "6650a1b2c3d4e5f6a7b8c9d9",
  "roomNumber": "A-101",
  "maxCapacity": 30,
  "isActive": true
}
```

**Field Specifications (`CreateClassDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `name` | `string` | ✅ | Class section name (e.g. `"1/1"`, `"1/2"`) |
| `gradeLevelId` | `string` | ✅ | GradeLevel MongoID |
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |
| `gender` | `string` | ✅ | Enum: `'male'` \| `'female'` \| `'both'` |
| `maxCapacity` | `number` | ✅ | Maximum capacity (min: 1) |
| `teacherInChargeId` | `string` | ❌ | Teacher MongoID in charge of class |
| `roomNumber` | `string` | ❌ | Physical room location code |
| `isActive` | `boolean` | ❌ | Active status (default: `true`) |

#### `POST /classes/copy-from/:targetYearId/:sourceYearId` 🔐
Copy class names, capacities, and room numbers from previous academic year. Body: none.

#### `GET /classes` 🔐
List classes (`Query: academicYearId`, `gradeLevelId`).

#### `GET /classes/list` 🔐
Get simplified class list for dropdowns.

#### `GET /classes/:id` 🔐
Get class details.

#### `PATCH /classes/:id` 🔐
Update class details. Accepts partial fields from `CreateClassDto`.

#### `PATCH /classes/:id/toggle-active` 🔐
Toggle active/inactive status. Body: none.

#### `DELETE /classes/:id` 🔐
Delete a class.

---

### 5.12 Enrollments & Bulk Student Promotion

Base path: `/enrollments`

#### `POST /enrollments` 🔐
Enroll a student into a class for an academic year.

**Request Payload (JSON):**
```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "classId": "6650a1b2c3d4e5f6a7b8c9d1",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d2"
}
```

**Field Specifications (`CreateEnrollmentDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `studentId` | `string` | ✅ | Student MongoID |
| `classId` | `string` | ✅ | Target Class MongoID |
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |

#### `GET /enrollments` 🔐
List enrollments with pagination and filters (`Query: studentId, classId, academicYearId, status`).

#### `GET /enrollments/promotion-preview/:targetAcademicYearId` 🔐
Preview bulk student promotion mapping to next grade level classes.

#### `POST /enrollments/bulk-promote/:targetAcademicYearId` 🔐
Execute bulk promotion of students into target year classes.

**Request Payload (JSON):**
```json
{
  "promotions": [
    {
      "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
      "targetClassId": "6650a1b2c3d4e5f6a7b8c9d3"
    },
    {
      "studentId": "6650a1b2c3d4e5f6a7b8c9d1",
      "targetClassId": "6650a1b2c3d4e5f6a7b8c9d4"
    }
  ],
  "excludedStudentIds": [
    "6650a1b2c3d4e5f6a7b8c9d9"
  ]
}
```

**Field Specifications (`BulkPromoteDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `promotions` | `SinglePromotionDto[]` | ✅ | Array of `{ studentId: string, targetClassId: string }` |
| `excludedStudentIds` | `string[]` | ❌ | Array of student MongoIDs to exclude from promotion |

#### `GET /enrollments/student/:studentId` 🔐
Get student enrollment history across academic years.

#### `DELETE /enrollments/:id` 🔐
Remove student enrollment.

---

### 5.13 Subject Offerings

Base path: `/subject-offerings`

#### `POST /subject-offerings` 🔐
Create a subject offering mapping a subject to a grade level and term.

**Request Payload (JSON):**
```json
{
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "gradeLevelId": "6650a1b2c3d4e5f6a7b8c9d1",
  "termId": "6650a1b2c3d4e5f6a7b8c9d2"
}
```

**Field Specifications (`CreateSubjectOfferingDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `subjectId` | `string` | ✅ | Master Subject MongoID |
| `gradeLevelId` | `string` | ✅ | GradeLevel MongoID |
| `termId` | `string` | ✅ | Term MongoID |

#### `POST /subject-offerings/copy-from/:targetYearId/:sourceYearId` 🔐
Copy subject offerings from a previous academic year. Body: none.

#### `GET /subject-offerings/by-term/:termId` 🔐
Get subject offerings for a specific term (optionally filtered by `Query: gradeLevelId`).

#### `GET /subject-offerings/:id` 🔐
Get subject offering details.

#### `DELETE /subject-offerings/:id` 🔐
Delete a subject offering.

---

### 5.14 Teacher Assignments

Base path: `/teacher-assignments`

#### `POST /teacher-assignments` 🔐
Assign a teacher to a subject offering.

**Request Payload (JSON):**
```json
{
  "teacherId": "6650a1b2c3d4e5f6a7b8c9d0",
  "subjectOfferingId": "6650a1b2c3d4e5f6a7b8c9d1"
}
```

**Field Specifications (`CreateTeacherAssignmentDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `teacherId` | `string` | ✅ | Teacher MongoID |
| `subjectOfferingId` | `string` | ✅ | SubjectOffering MongoID |

#### `GET /teacher-assignments` 🔐
List teacher assignments.

#### `GET /teacher-assignments/:id` 🔐
Get assignment details.

#### `DELETE /teacher-assignments/:id` 🔐
Delete teacher assignment.

---

### 5.15 Subjects Catalog

Base path: `/subjects`

#### `POST /subjects` 🔐
Create a new master subject in the tenant catalog.

**Request Payload (JSON):**
```json
{
  "subjectName": "الرياضيات",
  "subjectCode": "MATH101",
  "classIds": [
    "6650a1b2c3d4e5f6a7b8c9d0",
    "6650a1b2c3d4e5f6a7b8c9d1"
  ]
}
```

**Field Specifications (`CreateSubjectDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `subjectName` | `string` | ✅ | Name of the subject (min length: 2) |
| `subjectCode` | `string` | ❌ | Code of the subject (e.g. `"MATH101"`) |
| `classIds` | `string[]` | ❌ | Array of Class MongoIDs offering this subject |

#### `GET /subjects` 🔐
List master subjects.

#### `GET /subjects/student/me` 🔐 (STUDENT)
Get subjects offered to the logged-in student.

#### `GET /subjects/teacher/me` 🔐 (TEACHER)
Get subjects taught by the logged-in teacher.

#### `GET /subjects/list` 🔐
Simplified subject list for UI dropdowns.

#### `GET /subjects/:id` 🔐
Get subject details by ID.

#### `PATCH /subjects/:id` 🔐
Update subject details. Accepts partial fields from `CreateSubjectDto`.

#### `DELETE /subjects/:id` 🔐
Delete subject.

---

### 5.16 Teachers

Base path: `/teachers`

#### `POST /teachers` 🔐
Add a new teacher profile.

**Request Payload (JSON):**
```json
{
  "name": "مريم أحمد",
  "email": "mariam@teacher.com",
  "phoneNumber": "01143279213",
  "qualification": "تربية",
  "specialization": "علوم",
  "address": "أسيوط",
  "isActive": true,
  "subjectIds": [
    "6a69e3d436a10520bf956e46"
  ],
  "password": "TeacherPassword123"
}
```

**Field Specifications (`CreateTeacherDto`):**
> [!IMPORTANT]
> The field name for the phone number is **`phoneNumber`** (NOT `phone`). Request bodies containing `phone` will be rejected by NestJS ValidationPipe with `property phone should not exist`.

| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `name` | `string` | ✅ | Teacher full name (min length: 2) |
| `email` | `string` | ✅ | Unique teacher email address |
| `phoneNumber` | `string` | ❌ | Phone number (e.g. `01143279213`) |
| `qualification` | `string` | ❌ | Degree / qualification |
| `experience` | `string` | ❌ | Experience notes |
| `specialization` | `string` | ❌ | Subject specialization |
| `hireDate` | `string` | ❌ | ISO Date String (`YYYY-MM-DD`) |
| `address` | `string` | ❌ | Living address |
| `status` | `string` | ❌ | Status string (`"active"` \| `"inactive"`) |
| `isActive` | `boolean` | ❌ | Active status flag |
| `subjectIds` | `string[]` | ❌ | Array of Subject MongoIDs |
| `password` | `string` | ❌ | Login password (min length: 6) |

#### `GET /teachers` 🔐
List teachers (`Query: page, limit, name, email, specialization, isActive`).

#### `GET /teachers/me` 🔐 (TEACHER)
Get authenticated teacher profile.

#### `GET /teachers/list` 🔐
Simplified teacher list for dropdowns.

#### `GET /teachers/:id` 🔐
Get teacher details.

#### `PATCH /teachers/:id` 🔐
Update teacher profile. Accepts partial fields from `CreateTeacherDto` / `UpdateTeacherDto`.

**Request Payload (JSON):**
```json
{
  "name": "مريم أحمد علي",
  "phoneNumber": "01143279213",
  "specialization": "علوم عامة",
  "address": "أسيوط - شارع الثورة",
  "isActive": true
}
```

#### `PATCH /teachers/:id/toggle-active` 🔐
Toggle teacher active status. Body: none.

#### `DELETE /teachers/:id` 🔐
Delete a teacher profile.

---

### 5.17 Students & Portal OTP Setup

Base path: `/students`

#### `POST /students` 🔐
Create a new student profile.

**Request Payload (JSON):**
```json
{
  "firstName": "أحمد",
  "fatherName": "محمد",
  "familyName": "العلي",
  "birthDate": "2015-05-12",
  "gender": "male",
  "nationality": "سعودي",
  "phoneNumber": "0551122334",
  "email": "ahmed.student@school.com",
  "address": "الرياض - حي الملز",
  "classId": "6650a1b2c3d4e5f6a7b8c9d0",
  "isActive": true
}
```

**Field Specifications (`CreateStudentDto`):**
> [!IMPORTANT]
> Name parameters are split into **`firstName`**, **`fatherName`**, and **`familyName`**. Use **`phoneNumber`** for the phone number (NOT `phone`).

| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `firstName` | `string` | ✅ | Student first name (min length: 2) |
| `fatherName` | `string` | ✅ | Father name (min length: 2) |
| `familyName` | `string` | ✅ | Family/last name (min length: 2) |
| `birthDate` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |
| `gender` | `string` | ✅ | Enum: `'male'` \| `'female'` |
| `nationality` | `string` | ✅ | Student nationality |
| `phoneNumber` | `string` | ✅ | Phone number |
| `email` | `string` | ✅ | Valid email format |
| `address` | `string` | ✅ | Living address |
| `previousSchool` | `string` | ❌ | Previous school name |
| `registrationDate`| `string` | ❌ | ISO Date String |
| `notes` | `string` | ❌ | Administrative notes |
| `isActive` | `boolean` | ❌ | Active status flag |
| `password` | `string` | ❌ | Initial password (min length: 6) |
| `classId` | `string` | ❌ | Class MongoID for automatic enrollment |
| `status` | `string` | ❌ | `"active"` \| `"inactive"` |

#### `GET /students` 🔐
List students (`Query: page, limit, classId, gender, name, email, isActive`).

#### `GET /students/list` 🔐
Simplified student list for dropdowns.

#### `GET /students/me` 🔐 (STUDENT)
Get logged-in student profile.

#### `GET /students/:id` 🔐
Get student details.

#### `PATCH /students/:id` 🔐
Update student profile. Accepts partial fields from `CreateStudentDto`.

#### `PATCH /students/:id/toggle-active` 🔐
Toggle student active status. Body: none.

#### `DELETE /students/:id` 🔐
Delete student.

#### `POST /students/request-password-setup` 🔓
Request 6-digit OTP sent to personal email for student portal account activation.

**Request Payload (JSON):**
```json
{
  "email": "ahmed.student@school.com"
}
```

**Field Specifications (`RequestPasswordSetupDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | ✅ | Registered personal email of the student |

#### `POST /students/set-password` 🔓
Set portal password using the 6-digit OTP.

**Request Payload (JSON):**
```json
{
  "email": "ahmed.student@school.com",
  "otp": "123456",
  "password": "NewStudentPassword123"
}
```

**Field Specifications (`SetPasswordDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `email` | `string` | ✅ | Student email address |
| `otp` | `string` | ✅ | 6-digit OTP code received |
| `password` | `string` | ✅ | New portal password (min length: 6) |

---

### 5.18 Attendance

Base path: `/attendance`

#### `POST /attendance` 🔐
Create a new attendance record (mark student absence).

**Request Payload (JSON):**
```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "classId": "6650a1b2c3d4e5f6a7b8c9d1",
  "date": "2025-11-18"
}
```

**Field Specifications (`CreateAttendanceDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `studentId` | `string` | ✅ | Student MongoID |
| `classId` | `string` | ✅ | Class MongoID |
| `date` | `string` | ✅ | Date string in format `YYYY-MM-DD` |

#### `GET /attendance` 🔐
List attendance records (`Query: page, limit, _id, studentId, classId, date, createdAt, updatedAt`).

#### `GET /attendance/student/me` 🔐 (STUDENT)
Get authenticated student attendance/absence history.

#### `PATCH /attendance/:id` 🔐
Update attendance record. Accepts partial fields (`studentId`, `classId`, `date`).

#### `DELETE /attendance/:id` 🔐
Delete attendance record.

---

### 5.19 Lectures & Copy Schedule Engine

Base path: `/lectures`

#### `POST /lectures` 🔐
Create a single timetable lecture slot.

**Request Payload (JSON):**
```json
{
  "classId": "6650a1b2c3d4e5f6a7b8c9d0",
  "subjectOfferingId": "6650a1b2c3d4e5f6a7b8c9d1",
  "termId": "6650a1b2c3d4e5f6a7b8c9d2",
  "teacherId": "6650a1b2c3d4e5f6a7b8c9d3",
  "dayOfWeek": "Sunday",
  "slot": 1
}
```

**Field Specifications (`CreateLectureDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `classId` | `string` | ✅ | Class MongoID |
| `subjectOfferingId` | `string` | ✅ | SubjectOffering MongoID |
| `termId` | `string` | ✅ | Term MongoID |
| `teacherId` | `string` | ❌ | Teacher MongoID (optional) |
| `dayOfWeek` | `string` | ✅ | Enum: `"Sunday"` \| `"Monday"` \| `"Tuesday"` \| `"Wednesday"` \| `"Thursday"` \| `"Friday"` \| `"Saturday"` |
| `slot` | `number` | ✅ | Period slot number (1–10) |

#### `POST /lectures/copy-from/:targetYearId/:targetTermId/:sourceTermId` 🔐
Execute Copy Schedule Engine (Wizard Step 7). Body: none.

#### `GET /lectures` 🔐
List timetable lectures (`Query: termId, classId, teacherId`).

#### `GET /lectures/:id` 🔐
Get lecture details.

#### `PATCH /lectures/:id` 🔐
Update lecture slot or teacher. Accepts partial fields from `CreateLectureDto`.

#### `DELETE /lectures/:id` 🔐
Delete lecture slot.

---

### 5.20 Exams & Online Quiz System

Base path: `/exams`

#### `POST /exams` 🔐
Create an exam or online quiz.

**Request Payload (JSON):**
```json
{
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "termId": "6650a1b2c3d4e5f6a7b8c9d2",
  "classIds": [
    "6650a1b2c3d4e5f6a7b8c9d3"
  ],
  "examType": "final",
  "startDate": "2026-06-01",
  "endDate": "2026-06-01",
  "duration": 120,
  "questions": [
    {
      "question": "ما هي عاصمة المملكة العربية السعودية؟",
      "options": ["الرياض", "جدة", "مكة", "الدمام"],
      "correctAnswer": "الرياض"
    }
  ]
}
```

**Field Specifications (`CreateExamDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `subjectId` | `string` | ✅ | Subject MongoID |
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |
| `termId` | `string` | ❌ | Term MongoID (optional) |
| `classIds` | `string[]` | ✅ | Array of Class MongoIDs |
| `examType` | `string` | ✅ | Enum: `'final'` \| `'assignment'` \| `'activity'` \| `'quiz'` |
| `startDate` | `string` | ✅ | Start date (`YYYY-MM-DD`) |
| `endDate` | `string` | ✅ | End date (`YYYY-MM-DD`) |
| `duration` | `number` | ✅ | Exam duration in minutes (min: 1) |
| `questions` | `QuestionDto[]` | ✅ | Array of `{ question: string, options: string[], correctAnswer: string }` |

#### `GET /exams` 🔐
List exams (`Query: page, limit, classId, subjectId, academicYearId, termId, examType`).

#### `GET /exams/student/me` 🔐 (STUDENT)
Get active exams for student.

#### `GET /exams/:id` 🔐
Get exam details with questions.

#### `PATCH /exams/:id` 🔐
Update exam parameters. Accepts partial fields from `CreateExamDto`.

#### `DELETE /exams/:id` 🔐
Delete exam.

#### `POST /exams/:examId/questions` 🔐
Add a question to exam. Payload: `QuestionDto` (`{ question, options, correctAnswer }`).

#### `PATCH /exams/:examId/questions/:questionId` 🔐
Update an exam question. Payload: partial `QuestionDto`.

#### `DELETE /exams/:examId/questions/:questionId` 🔐
Delete an exam question. Body: none.

#### `POST /exams/:examId/start` 🔐 (STUDENT)
Start taking an online exam. Body: none.

#### `POST /exams/:examId/grade` 🔐 (STUDENT)
Submit answers for automated grading.

**Request Payload (JSON):**
```json
{
  "answers": [
    {
      "questionId": "6650a1b2c3d4e5f6a7b8c9d9",
      "answer": "الرياض"
    }
  ]
}
```

**Field Specifications (`SubmitAnswersDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `answers` | `AnswerDto[]` | ✅ | Array of `{ questionId: string, answer: string }` |

#### `PATCH /exams/:examId/students/:studentId/grade` 🔐 (TEACHER)
Manually grade or override student exam score.

**Request Payload (JSON):**
```json
{
  "score": 95,
  "teacherNotes": "ممتاز"
}
```

#### `DELETE /exams/deleteAll` 🔐
Bulk delete exams. Body: none.

---

### 5.21 Grades Criteria

Base path: `/gradesCriteria`

#### `POST /gradesCriteria` 🔐
Create grade weighting criteria for a subject and academic year.

**Request Payload (JSON):**
```json
{
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "final": 40,
  "assignments": 15,
  "assignmentsCount": 3,
  "activities": 15,
  "projects": 15,
  "projectsCount": 2,
  "quizzes": 15,
  "quizzesCount": 3
}
```

**Field Specifications (`CreateGradesCriteriaDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `subjectId` | `string` | ✅ | Subject MongoID |
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |
| `final` | `number` | ✅ | Final exam weight (1–100) |
| `assignments` | `number` | ✅ | Total assignments weight (1–100) |
| `assignmentsCount` | `number` | ✅ | Number of assignments (min: 1) |
| `activities` | `number` | ✅ | Total activities weight (1–100) |
| `projects` | `number` | ✅ | Total projects weight (1–100) |
| `projectsCount` | `number` | ✅ | Number of projects (min: 1) |
| `quizzes` | `number` | ✅ | Total quizzes weight (1–100) |
| `quizzesCount` | `number` | ✅ | Number of quizzes (min: 1) |

#### `GET /gradesCriteria` 🔐
List grade criteria.

#### `GET /gradesCriteria/student/me` 🔐 (STUDENT)
Get grade criteria for student's subjects.

#### `GET /gradesCriteria/student/me/subjects` 🔐 (STUDENT)
Get student's subjects list.

#### `GET /gradesCriteria/student/me/grades` 🔐 (STUDENT)
Get student's computed grades breakdown (`?subjectId=...`).

#### `GET /gradesCriteria/:id` 🔐
Get criteria details.

#### `PATCH /gradesCriteria/:id` 🔐
Update grade criteria percentages. Accepts partial fields from `CreateGradesCriteriaDto`.

#### `DELETE /gradesCriteria/:id` 🔐
Delete grade criteria.

---

### 5.22 Projects & File Submissions

Base path: `/projects`

#### `POST /projects` 🔐
Create a project assignment.

**Request Payload (JSON / multipart form-data):**
```json
{
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "termId": "6650a1b2c3d4e5f6a7b8c9d2",
  "classIds": [
    "6650a1b2c3d4e5f6a7b8c9d3"
  ],
  "title": "مشروع العلوم البيئية",
  "description": "قم بعمل بحث وتصميم عرض تقديمي عن التلوث البيئي",
  "dueDate": "2026-05-30T23:59:59.000Z",
  "filePaths": []
}
```

**Field Specifications (`CreateProjectDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `subjectId` | `string` | ✅ | Subject MongoID |
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |
| `termId` | `string` | ❌ | Term MongoID (optional) |
| `classIds` | `string[]` | ❌ | Array of Class MongoIDs |
| `title` | `string` | ✅ | Project title |
| `description` | `string` | ✅ | Project description |
| `dueDate` | `string` | ✅ | Due date ISO string |
| `filePaths` | `string[]` | ❌ | Array of uploaded file paths |

#### `GET /projects` 🔐
List project assignments.

#### `GET /projects/teacher/me` 🔐 (TEACHER)
Get projects created by teacher.

#### `GET /projects/student/me` 🔐 (STUDENT)
Get projects assigned to student.

#### `GET /projects/:id` 🔐
Get project details.

#### `GET /projects/:id/download` 🔐
Download project instructions file.

#### `PATCH /projects/:id` 🔐
Update project. Accepts partial fields from `CreateProjectDto`.

#### `DELETE /projects/:id` 🔐
Delete project.

#### `POST /projects/:id/files` 🔐
Upload additional files to project. Form-data key: `files`.

#### `DELETE /projects/:id/files/:filename` 🔐
Delete project file attachment. Body: none.

#### `GET /projects/submissions` 🔐
List project submissions.

#### `POST /projects/:projectId/submit` 🔐 (STUDENT)
Submit student project response file. Form-data key: `files`.

#### `DELETE /projects/:projectId/submit/files/:filename` 🔐 (STUDENT)
Remove file from project submission. Body: none.

#### `GET /projects/:projectId/my-submission` 🔐 (STUDENT)
Get logged-in student's project submission status.

#### `GET /projects/:projectId/submissions` 🔐 (TEACHER)
List all student submissions for a project.

#### `GET /projects/:projectId/submissions/:studentId/download` 🔐 (TEACHER)
Download student submission file.

#### `PATCH /projects/:projectId/submissions/:studentId/grade` 🔐 (TEACHER)
Grade student project submission.

**Request Payload (JSON):**
```json
{
  "grade": 90,
  "feedback": "عمل ممتاز ومجهود رائع"
}
```

#### `DELETE /projects/deleteAll` 🔐
Bulk delete projects. Body: none.

---

### 5.23 Lesson Preparation

Base path: `/preparation`

#### `POST /preparation` 🔐 (TEACHER)
Create lesson preparation record for a lecture.

**Request Payload (JSON / form-data):**
```json
{
  "lecture": "507f1f77bcf86cd799439011",
  "filePaths": ["uploads/preparations/lesson1.pdf"]
}
```

**Field Specifications (`CreatePreparationDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `lecture` | `string` | ✅ | Lecture MongoID |
| `filePaths` | `string[]` | ❌ | Array of file attachment paths |

#### `GET /preparation` 🔐
List lesson preparations (`Query: lectureId, teacherId`).

#### `GET /preparation/:id` 🔐
Get lesson preparation details.

#### `PATCH /preparation/:id` 🔐
Update lesson preparation. Accepts partial fields from `CreatePreparationDto`.

#### `DELETE /preparation/:id` 🔐
Delete lesson preparation.

#### `POST /preparation/:id/files` 🔐
Upload attachments to lesson preparation. Form-data key: `files`.

#### `DELETE /preparation/:id/files/:filename` 🔐
Delete attachment from lesson preparation. Body: none.

---

### 5.24 Digital Library

Base path: `/library`

#### `POST /library` 🔐
Add a new resource link to digital library.

**Request Payload (JSON):**
```json
{
  "title": "كتاب العلوم الصف الأول",
  "link": "https://library.school.com/books/science1.pdf",
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "termId": "6650a1b2c3d4e5f6a7b8c9d2"
}
```

**Field Specifications (`CreateLibraryDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | ✅ | Resource title (min length: 2) |
| `link` | `string` | ✅ | Valid URL string |
| `subjectId` | `string` | ❌ | Associated Subject MongoID |
| `academicYearId` | `string` | ❌ | Associated AcademicYear MongoID |
| `termId` | `string` | ❌ | Associated Term MongoID |

#### `GET /library` 🔐
List library resources (`Query: page, limit, subjectId, academicYearId, termId`).

#### `GET /library/:id` 🔐
Get library resource details.

#### `PATCH /library/:id` 🔐
Update library resource. Accepts partial fields from `CreateLibraryDto`.

#### `DELETE /library/:id` 🔐
Delete library resource.

---

### 5.25 Financial — Records & Student Ledgers

Base path: `/financial/records`

#### `GET /financial/records` 🛡️
List financial records for all students (`Query: page, limit, studentId, academicYear`).

#### `GET /financial/records/me` 🔐 (STUDENT)
Get logged-in student's financial ledger.

#### `GET /financial/records/me/summary` 🔐 (STUDENT)
Get summary of dues & payments for logged-in student.

#### `GET /financial/records/me/trips` 🔐 (STUDENT)
Get logged-in student's trip financial records.

#### `GET /financial/records/:studentId` 🛡️
Get specific student's financial record.

#### `GET /financial/records/:studentId/summary` 🛡️
Get student financial summary.

#### `POST /financial/records/:studentId/tuition/pay` 🛡️
Record a tuition fee installment payment.

**Request Payload (JSON):**
```json
{
  "installmentNumber": 1,
  "amount": 2500,
  "paidAt": "2025-09-15",
  "notes": "إيصال رقم 1042"
}
```

**Field Specifications (`RecordPaymentDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `installmentNumber` | `number` | ✅ | Installment number to mark as paid (1-based, min: 1) |
| `amount` | `number` | ✅ | Payment amount received (min: 0) |
| `paidAt` | `string` | ✅ | Date received (`YYYY-MM-DD`) |
| `notes` | `string` | ❌ | Optional payment notes / receipt number |

---

### 5.26 Financial — Fee Configs

Base path: `/financial/fee-configs`

#### `POST /financial/fee-configs` 🛡️
Create annual tuition fee configuration for an academic level.

**Request Payload (JSON):**
```json
{
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d0",
  "tuitionFee": 10000
}
```

**Field Specifications (`CreateFeeConfigDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `academicYearId` | `string` | ✅ | AcademicYear MongoID |
| `tuitionFee` | `number` | ✅ | Annual tuition fee amount in EGP (min: 0) |

#### `GET /financial/fee-configs` 🛡️
List fee configurations.

#### `GET /financial/fee-configs/:id` 🛡️
Get fee configuration details.

#### `PATCH /financial/fee-configs/:id` 🛡️
Update fee configuration.

**Request Payload (JSON):**
```json
{
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d0",
  "tuitionFee": 12000
}
```

**Field Specifications (`UpdateFeeConfigDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `academicYearId` | `string` | ❌ | Associated AcademicYear MongoID |
| `tuitionFee` | `number` | ❌ | Updated tuition fee amount (min: 0) |

#### `DELETE /financial/fee-configs/:id` 🛡️
Delete fee configuration.

---

### 5.27 Financial — Installment Plans

Base path: `/financial/installment-plans`

#### `POST /financial/installment-plans` 🛡️
Create tuition installment plan template.

**Request Payload (JSON):**
```json
{
  "name": "4 خيارات متساوية",
  "description": "تقسيط المصروفات على 4 أقساط متساوية",
  "numberOfInstallments": 4,
  "dueDates": [
    "2025-09-01",
    "2025-11-01",
    "2026-01-01",
    "2026-03-01"
  ],
  "isDefault": true
}
```

**Field Specifications (`CreateInstallmentPlanDto`):**
| Field | Type | Required | Rules & Description |
|---|---|---|---|
| `name` | `string` | ✅ | Plan name |
| `description` | `string` | ❌ | Plan description |
| `numberOfInstallments` | `number` | ✅ | Number of installments (min: 1) |
| `dueDates` | `string[]` | ✅ | Array of ISO Date strings (length MUST match `numberOfInstallments`) |
| `isDefault` | `boolean` | ❌ | Set as default template (default: `false`) |

#### `GET /financial/installment-plans` 🛡️
List installment plans.

#### `GET /financial/installment-plans/:id` 🛡️
Get installment plan details.

#### `PATCH /financial/installment-plans/:id` 🛡️
Update installment plan template. Accepts partial fields from `CreateInstallmentPlanDto`.

#### `PATCH /financial/installment-plans/:id/set-default` 🛡️
Set plan as default for new enrollments. Body: none.

#### `DELETE /financial/installment-plans/:id` 🛡️
Delete installment plan template.

---

### 5.28 Financial — Discounts

Base path: `/financial/discounts`

#### `POST /financial/discounts` 🛡️
Create discount policy.

**Request Payload (JSON):**
```json
{
  "name": "خصم الأشقاء",
  "description": "يخصم للعائلات التي لديها أكثر من طالب",
  "percentage": 10
}
```

**Field Specifications (`CreateDiscountDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Discount policy name |
| `description` | `string` | ❌ | Discount policy description |
| `percentage` | `number` | ✅ | Discount percentage (0–100) |

#### `GET /financial/discounts` 🛡️
List discount policies.

#### `GET /financial/discounts/:id` 🛡️
Get discount policy details.

#### `PATCH /financial/discounts/:id` 🛡️
Update discount policy. Accepts partial fields from `CreateDiscountDto`.

#### `DELETE /financial/discounts/:id` 🛡️
Delete discount policy.

#### `POST /financial/discounts/apply/tuition/:studentId` 🛡️
Apply discount to student tuition.

**Request Payload (JSON):**
```json
{
  "discountId": "6650a1b2c3d4e5f6a7b8c9d0"
}
```

**Field Specifications (`ApplyDiscountDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `discountId` | `string` | ✅ | Discount template MongoID |

#### `DELETE /financial/discounts/apply/tuition/:studentId` 🛡️
Remove discount from student tuition. Body: none.

#### `POST /financial/discounts/apply/bus/:studentId` 🛡️
Apply discount to student bus fee. Uses `ApplyDiscountDto` (`{ discountId }`).

#### `DELETE /financial/discounts/apply/bus/:studentId` 🛡️
Remove discount from student bus fee. Body: none.

#### `POST /financial/discounts/apply/trips/:studentId/:tripId` 🛡️
Apply discount to student trip fee. Uses `ApplyDiscountDto` (`{ discountId }`).

#### `DELETE /financial/discounts/apply/trips/:studentId/:tripId` 🛡️
Remove discount from student trip fee. Body: none.

---

### 5.29 Financial — Additional Fees

Base path: `/financial/additional-fees`

#### `POST /financial/additional-fees` 🛡️
Create an additional fee (books, uniform, activity fee).

**Request Payload (JSON):**
```json
{
  "name": "رسوم الكتب المدرسية",
  "description": "حقيبة الكتب كاملة للفصل الدراسي الأول",
  "amount": 500,
  "targetType": "class",
  "targetId": "6650a1b2c3d4e5f6a7b8c9d0"
}
```

**Field Specifications (`CreateAdditionalFeeDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Additional fee name |
| `description` | `string` | ❌ | Additional fee description |
| `amount` | `number` | ✅ | Fee amount in EGP (min: 0) |
| `targetType` | `string` | ✅ | Enum: `"all"` \| `"student"` \| `"class"` \| `"academicYear"` |
| `targetId` | `string` | ❌ | Student MongoID or Class MongoID (required if targetType is `"student"` or `"class"`) |
| `targetAcademicYear` | `string` | ❌ | Grade level / year string (required if targetType is `"academicYear"`) |

#### `GET /financial/additional-fees` 🛡️
List additional fees.

#### `GET /financial/additional-fees/:id` 🛡️
Get additional fee details.

#### `DELETE /financial/additional-fees/:id` 🛡️
Delete additional fee.

#### `POST /financial/additional-fees/:feeId/pay/:studentId` 🛡️
Record student payment for additional fee.

---

### 5.30 Financial — Bus Subscription Module

Base path: `/financial/bus` & `/financial/records/:studentId/bus`

#### `POST /financial/records/:studentId/bus/enroll` 🛡️
Enroll student in bus service.

**Request Payload (JSON):**
```json
{
  "fee": 3000,
  "serviceType": "both",
  "installmentPlanId": "6650a1b2c3d4e5f6a7b8c9d0"
}
```

**Field Specifications (`EnrollBusDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `fee` | `number` | ✅ | Annual bus fee in EGP (min: 0) |
| `serviceType` | `string` | ✅ | Enum: `'pickup'` \| `'dropoff'` \| `'both'` |
| `installmentPlanId` | `string` | ❌ | InstallmentPlan MongoID (omit for single full payment) |

#### `POST /financial/records/:studentId/bus/pay` 🛡️
Record bus fee installment payment. Uses `RecordPaymentDto` (`{ installmentNumber, amount, paidAt, notes }`).

#### `DELETE /financial/records/:studentId/bus/unenroll` 🛡️
Unenroll student from bus service. Body: none.

#### `GET /financial/bus/subscriptions` 🛡️
List all bus subscription records (`Query: page, limit, serviceType, studentId`).

#### `GET /financial/bus/candidates` 🛡️
List students eligible for bus enrollment.

#### `GET /financial/bus/me` 🔐 (STUDENT)
Get student's own bus subscription status.

#### `GET /financial/bus/:studentId` 🛡️
Get specific student's bus subscription.

---

### 5.31 Financial — Trips Subscription Module

Base path: `/financial/trips` & `/financial/records/:studentId/trips`

#### `POST /financial/trips` 🛡️
Create a new school trip event template.

**Request Payload (JSON):**
```json
{
  "name": "رحلة مجمع العلوم والتكنولوجيا",
  "description": "رحلة علمية ترفيهية",
  "fee": 150
}
```

**Field Specifications (`CreateFinancialTripDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Trip title |
| `description` | `string` | ❌ | Trip description |
| `fee` | `number` | ✅ | Trip fee in EGP (min: 0) |

#### `GET /financial/trips` 🛡️
List all trip templates.

#### `GET /financial/trips/:tripId` 🛡️
Get trip template details.

#### `GET /financial/trips/:tripId/students` 🛡️
List students registered for trip.

#### `GET /financial/trips/:tripId/candidates` 🛡️
List candidates eligible for trip.

#### `POST /financial/trips/:tripId/register` 🛡️
Register student for trip.

**Request Payload (JSON):**
```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "installmentPlanId": "6650a1b2c3d4e5f6a7b8c9d1"
}
```

**Field Specifications (`EnrollTripStudentDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `studentId` | `string` | ✅ | Student MongoID |
| `installmentPlanId` | `string` | ❌ | Optional installment plan MongoID |

#### `POST /financial/records/:studentId/trips/:tripId/pay` 🛡️
Record payment for student trip. Uses `RecordPaymentDto` (`{ installmentNumber, amount, paidAt, notes }`).

#### `DELETE /financial/trips/:tripId/unregister/:studentId` 🛡️
Unregister student from trip. Body: none.

#### `DELETE /financial/trips/:tripId` 🛡️
Delete trip template. Body: none.

---

### 5.32 Expenses — Categories

Base path: `/expenses/categories`

#### `POST /expenses/categories` 🛡️
Create expense category (salaries, utilities, maintenance).

**Request Payload (JSON):**
```json
{
  "name": "صيانة دورية",
  "description": "أعمال الصيانة والتجهيزات"
}
```

**Field Specifications (`CreateExpenseCategoryDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Category name |
| `description` | `string` | ❌ | Category description |

#### `GET /expenses/categories` 🛡️
List expense categories.

#### `GET /expenses/categories/:id` 🛡️
Get category details.

#### `PATCH /expenses/categories/:id` 🛡️
Update expense category. Accepts partial fields from `CreateExpenseCategoryDto`.

#### `DELETE /expenses/categories/:id` 🛡️
Delete expense category.

---

### 5.33 Expenses

Base path: `/expenses`

#### `POST /expenses` 🛡️
Log a new operational expense.

**Request Payload (JSON):**
```json
{
  "name": "إصلاح أجهزة التكييف",
  "amount": 1500,
  "categoryId": "6650a1b2c3d4e5f6a7b8c9d0",
  "date": "2025-09-01",
  "academicYear": "2025-2026",
  "notes": "تم الصيانة بواسطة شركة التبريد"
}
```

**Field Specifications (`CreateExpenseDto`):**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Expense title |
| `amount` | `number` | ✅ | Amount spent in EGP (min: 0) |
| `categoryId` | `string` | ✅ | Category MongoID |
| `date` | `string` | ✅ | ISO Date String (`YYYY-MM-DD`) |
| `academicYear` | `string` | ❌ | Academic year string |
| `notes` | `string` | ❌ | Optional notes |

#### `GET /expenses` 🛡️
List operational expenses (`Query: page, limit, categoryId, academicYear, date`).

#### `GET /expenses/:id` 🛡️
Get expense record details.

#### `PATCH /expenses/:id` 🛡️
Update expense record. Accepts partial fields from `CreateExpenseDto`.

#### `DELETE /expenses/:id` 🛡️
Delete expense record.

---

### 5.34 System Health & Diagnostics

Base path: `/`

#### `GET /health-check` 🔓
Basic health check endpoint returning server timestamp & uptime.

#### `GET /api/v1/health-check` 🔓
Versioned health check alias endpoint.

#### `GET /test` 🔓
Diagnostic endpoint.

---

## 6. Standard Response Envelope

All API responses are wrapped by the `ResponseInterceptor`:

```json
{
  "statusCode": 200,
  "message": "Operation successful",
  "data": { ... },
  "timestamp": "2026-08-02T09:35:00.000Z"
}
```

---

## 7. Environment Variables

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/nasaq-db
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRATION=7d
```

