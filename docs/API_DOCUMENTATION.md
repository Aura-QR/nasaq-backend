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

```json
{
  "schoolName": "مدرسة النور الأهلية",
  "slug": "alnoor",
  "email": "admin@alnoor.sa",
  "phone": "+966555123456",
  "country": "Saudi Arabia",
  "city": "الرياض",
  "address": "طريق الملك فهد",
  "ownerName": "المهندس فهد العتيبي",
  "ownerEmail": "owner@alnoor.sa",
  "ownerPassword": "OwnerPassword123!"
}
```

#### `GET /platform/schools` 🛡️ (SUPER_ADMIN)
Lists all registered school tenants on the platform.

#### `GET /platform/schools/:id` 🛡️ (SUPER_ADMIN)
Get detailed tenant profile and settings by ID.

#### `PATCH /platform/schools/:id` 🛡️ (SUPER_ADMIN)
Update school tenant configuration.

#### `PATCH /platform/schools/:id/suspend` 🛡️ (SUPER_ADMIN)
Suspend a school tenant's subscription and block access.

#### `PATCH /platform/schools/:id/activate` 🛡️ (SUPER_ADMIN)
Re-activate a suspended school tenant.

---

### 5.2 Authentication (Login Endpoints)

#### `POST /auth/login` 🔓
Unified login endpoint for School Users (`OWNER`, `MANAGER`, `TEACHER`, `STUDENT`).

```json
{
  "email": "owner@alnoor.sa",
  "password": "Password123!"
}
```

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

#### `POST /platform/auth/login` 🔓
Platform Super Admin login endpoint.

---

### 5.3 Managers Management (OWNER Only)

Base path: `/managers`

#### `POST /managers` 🛡️
Create a new dedicated manager account.

#### `PATCH /managers/promote/:teacherId` 🛡️
Promote an existing teacher to hold dual Manager privileges.

#### `PATCH /managers/demote/:teacherId` 🛡️
Demote a teacher-manager back to standard teacher permissions.

#### `PATCH /managers/:id/permissions` 🛡️
Set custom permission overrides array for a manager.

#### `GET /managers` 🛡️
List all administrative manager accounts in the school.

#### `DELETE /managers/:id` 🛡️
Delete a manager account.

---

### 5.4 Permissions & Dynamic Role Controls

Base path: `/permissions`

#### `GET /permissions` 🔐
Get current user's effective permission list.

#### `POST /permissions/sync-financial` 🛡️
Sync default financial permissions across role documents.

---

### 5.5 Dashboards & Analytics

Base path: `/dashboards`

#### `GET /dashboards/owner` 🛡️ (OWNER)
Get complete executive financial, academic, and administrative analytics.

#### `GET /dashboards/manager` 🛡️ (MANAGER)
Get manager dashboard filtered by granted permission permissions.

#### `GET /dashboards/super-admin` 🛡️ (SUPER_ADMIN)
Get cross-tenant platform overview analytics.

---

### 5.6 Admin User Management

Base path: `/admin`

#### `GET /admin` 🔐
List all admin accounts in the tenant.

#### `GET /admin/:id` 🔐
Get admin profile by ID.

#### `PATCH /admin/:id` 🔐
Update admin profile details.

#### `DELETE /admin/:id` 🔐
Delete an admin account.

---

### 5.7 Academic Years & Start New Year Wizard

Base path: `/academic-years`

#### `POST /academic-years` 🔐
Create a new academic year (archives the current active year).

```json
{
  "name": "2027/2028",
  "startDate": "2027-09-01",
  "endDate": "2028-05-15",
  "status": "active"
}
```

#### `GET /academic-years` 🔐
List all academic years for the tenant.

#### `GET /academic-years/active` 🔐
Get the currently active academic year.

#### `GET /academic-years/:id` 🔐
Get academic year details.

#### `PATCH /academic-years/:id` 🔐
Update academic year details.

#### `PATCH /academic-years/:id/setup-step` 🔐
Update setup wizard progress step (`setup_terms`, `setup_stages`, `setup_classes`, `setup_subject_offerings`, `setup_teacher_assignments`, `setup_schedule`, `completed`).

#### `DELETE /academic-years/:id` 🔐
Delete an academic year.

---

### 5.8 Terms

Base path: `/terms`

#### `POST /terms` 🔐
Create a single term.

#### `POST /terms/bulk` 🔐
Create bulk terms for an academic year.

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
Copy term names & structure from a previous academic year.

#### `GET /terms` 🔐
List terms (filterable by `academicYearId`).

#### `GET /terms/:id` 🔐
Get term details.

#### `PATCH /terms/:id` 🔐
Update term details.

#### `DELETE /terms/:id` 🔐
Delete a term.

---

### 5.9 Stages

Base path: `/stages`

#### `POST /stages` 🔐
Create a tenant-scoped stage (e.g., "الابتدائي").

#### `GET /stages` 🔐
List all tenant stages sorted by order.

#### `GET /stages/:id` 🔐
Get stage details.

#### `PATCH /stages/:id` 🔐
Update stage name or order.

#### `DELETE /stages/:id` 🔐
Delete a stage.

---

### 5.10 Grade Levels

Base path: `/grade-levels`

#### `POST /grade-levels` 🔐
Create a grade level linked to a stage.

#### `GET /grade-levels` 🔐
List all grade levels sorted by global progression order.

#### `GET /grade-levels/next/:id` 🔐
Get the next grade level in progression (used for student promotion preview).

#### `GET /grade-levels/:id` 🔐
Get grade level details.

#### `PATCH /grade-levels/:id` 🔐
Update grade level.

#### `DELETE /grade-levels/:id` 🔐
Delete a grade level.

---

### 5.11 Classes

Base path: `/classes`

#### `POST /classes` 🔐
Create a classroom section under a grade level and academic year.

```json
{
  "name": "1/1",
  "gradeLevelId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d1",
  "gender": "male",
  "maxCapacity": 30,
  "roomNumber": "A-101"
}
```

#### `POST /classes/copy-from/:targetYearId/:sourceYearId` 🔐
Copy class names, capacities, and room numbers from previous academic year.

#### `GET /classes` 🔐
List classes (filter by `academicYearId`, `gradeLevelId`).

#### `GET /classes/list` 🔐
Get simplified class list for dropdowns.

#### `GET /classes/:id` 🔐
Get class details.

#### `PATCH /classes/:id` 🔐
Update class details.

#### `PATCH /classes/:id/toggle-active` 🔐
Toggle active/inactive status.

#### `DELETE /classes/:id` 🔐
Delete a class.

---

### 5.12 Enrollments & Bulk Student Promotion

Base path: `/enrollments`

#### `POST /enrollments` 🔐
Enroll a student into a class for an academic year.

```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "classId": "6650a1b2c3d4e5f6a7b8c9d1",
  "academicYearId": "6650a1b2c3d4e5f6a7b8c9d2"
}
```

#### `GET /enrollments` 🔐
List enrollments with pagination and filters.

#### `GET /enrollments/promotion-preview/:targetAcademicYearId` 🔐
Preview bulk student promotion mapping to next grade level classes.

#### `POST /enrollments/bulk-promote/:targetAcademicYearId` 🔐
Execute bulk promotion of students into target year classes.

```json
{
  "promotions": [
    { "studentId": "6650a1b2c3d4e5f6a7b8c9d0", "targetClassId": "6650a1b2c3d4e5f6a7b8c9d3", "action": "promote" },
    { "studentId": "6650a1b2c3d4e5f6a7b8c9d1", "targetClassId": "6650a1b2c3d4e5f6a7b8c9d1", "action": "retain" }
  ]
}
```

#### `GET /enrollments/student/:studentId` 🔐
Get student enrollment history across academic years.

#### `DELETE /enrollments/:id` 🔐
Remove student enrollment.

---

### 5.13 Subject Offerings

Base path: `/subject-offerings`

#### `POST /subject-offerings` 🔐
Create a subject offering mapping a subject to a grade level and term.

#### `POST /subject-offerings/copy-from/:targetYearId/:sourceYearId` 🔐
Copy subject offerings from a previous academic year.

#### `GET /subject-offerings` 🔐
List subject offerings (filter by `gradeLevelId`, `termId`).

#### `GET /subject-offerings/:id` 🔐
Get subject offering details.

#### `DELETE /subject-offerings/:id` 🔐
Delete a subject offering.

---

### 5.14 Teacher Assignments

Base path: `/teacher-assignments`

#### `POST /teacher-assignments` 🔐
Assign a teacher to a subject offering.

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
Update subject details.

#### `DELETE /subjects/:id` 🔐
Delete subject.

---

### 5.16 Teachers

Base path: `/teachers`

#### `POST /teachers` 🔐
Add a new teacher profile.

#### `GET /teachers` 🔐
List teachers (paginated + filterable).

#### `GET /teachers/me` 🔐 (TEACHER)
Get authenticated teacher profile.

#### `GET /teachers/list` 🔐
Simplified teacher list for dropdowns.

#### `GET /teachers/:id` 🔐
Get teacher details.

#### `PATCH /teachers/:id` 🔐
Update teacher profile.

#### `PATCH /teachers/:id/toggle-active` 🔐
Toggle teacher active status.

#### `DELETE /teachers/:id` 🔐
Delete a teacher profile.

---

### 5.17 Students & Portal OTP Setup

Base path: `/students`

#### `POST /students` 🔐
Create a new student profile.

#### `GET /students` 🔐
List students (paginated + filterable).

#### `GET /students/list` 🔐
Simplified student list for dropdowns.

#### `GET /students/me` 🔐 (STUDENT)
Get logged-in student profile.

#### `GET /students/:id` 🔐
Get student details.

#### `PATCH /students/:id` 🔐
Update student profile.

#### `PATCH /students/:id/toggle-active` 🔐
Toggle student active status.

#### `DELETE /students/:id` 🔐
Delete student.

#### `POST /students/request-password-setup` 🔓
Request OTP for portal activation.

#### `POST /students/set-password` 🔓
Set portal password using OTP.

---

### 5.18 Attendance

Base path: `/attendance`

#### `POST /attendance` 🔐
Record student attendance for a class lecture.

```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "classId": "6650a1b2c3d4e5f6a7b8c9d1",
  "date": "2026-09-02",
  "status": "present"
}
```

#### `GET /attendance` 🔐
List attendance records (filter by `classId`, `date`, `studentId`).

#### `GET /attendance/student/me` 🔐 (STUDENT)
Get authenticated student attendance history.

#### `PATCH /attendance/:id` 🔐
Update attendance record.

#### `DELETE /attendance/:id` 🔐
Delete attendance record.

---

### 5.19 Lectures & Copy Schedule Engine

Base path: `/lectures`

#### `POST /lectures` 🔐
Create a single timetable lecture slot.

#### `POST /lectures/copy-from/:targetYearId/:targetTermId/:sourceTermId` 🔐
Execute Copy Schedule Engine (Wizard Step 7). Returns 4 result buckets:
- `created`: Successfully matched & created lectures.
- `unresolved`: Subject not offered in target term.
- `needsTeacher`: Subject offered, but no teacher assigned in target year.
- `teacherConflict`: Teacher already booked at slot in target term (created with `teacherId = null`).

#### `GET /lectures` 🔐
List timetable lectures (filter by `termId`, `classId`, `teacherId`).

#### `GET /lectures/:id` 🔐
Get lecture details.

#### `PATCH /lectures/:id` 🔐
Update lecture slot or teacher.

#### `DELETE /lectures/:id` 🔐
Delete lecture slot.

---

### 5.20 Exams & Online Quiz System

Base path: `/exams`

#### `POST /exams` 🔐
Create an exam or online quiz.

#### `GET /exams` 🔐
List exams.

#### `GET /exams/student/me` 🔐 (STUDENT)
Get active exams for student.

#### `GET /exams/:id` 🔐
Get exam details with questions.

#### `PATCH /exams/:id` 🔐
Update exam parameters.

#### `DELETE /exams/:id` 🔐
Delete exam.

#### `POST /exams/:examId/questions` 🔐
Add a question to exam.

#### `PATCH /exams/:examId/questions/:questionId` 🔐
Update an exam question.

#### `DELETE /exams/:examId/questions/:questionId` 🔐
Delete an exam question.

#### `POST /exams/:examId/start` 🔐 (STUDENT)
Start taking an online exam.

#### `POST /exams/:examId/grade` 🔐 (STUDENT)
Submit answers for automated grading.

#### `PATCH /exams/:examId/students/:studentId/grade` 🔐 (TEACHER)
Manually grade or override student exam score.

#### `DELETE /exams/deleteAll` 🔐
Bulk delete exams.

---

### 5.21 Grades Criteria

Base path: `/grades-criteria`

#### `POST /grades-criteria` 🔐
Create grade weighting criteria for a subject and academic year.

#### `GET /grades-criteria` 🔐
List grade criteria.

#### `GET /grades-criteria/my-criteria` 🔐 (STUDENT)
Get grade criteria for student's subjects.

#### `GET /grades-criteria/my-subjects` 🔐 (STUDENT)
Get student's subjects list.

#### `GET /grades-criteria/my-grades` 🔐 (STUDENT)
Get student's computed grades breakdown.

#### `GET /grades-criteria/:id` 🔐
Get criteria details.

#### `PATCH /grades-criteria/:id` 🔐
Update grade criteria percentages.

#### `DELETE /grades-criteria/:id` 🔐
Delete grade criteria.

---

### 5.22 Projects & File Submissions

Base path: `/projects`

#### `POST /projects` 🔐
Create a project assignment.

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
Update project.

#### `DELETE /projects/:id` 🔐
Delete project.

#### `POST /projects/:id/files` 🔐
Upload additional files to project.

#### `DELETE /projects/:id/files/:filename` 🔐
Delete project file attachment.

#### `GET /projects/submissions` 🔐
List project submissions.

#### `POST /projects/:projectId/submit` 🔐 (STUDENT)
Submit student project response file.

#### `DELETE /projects/:projectId/submit/files/:filename` 🔐 (STUDENT)
Remove file from project submission.

#### `GET /projects/:projectId/my-submission` 🔐 (STUDENT)
Get logged-in student's project submission status.

#### `GET /projects/:projectId/submissions` 🔐 (TEACHER)
List all student submissions for a project.

#### `GET /projects/:projectId/submissions/:studentId/download` 🔐 (TEACHER)
Download student submission file.

#### `PATCH /projects/:projectId/submissions/:studentId/grade` 🔐 (TEACHER)
Grade student project submission.

#### `DELETE /projects/deleteAll` 🔐
Bulk delete projects.

---

### 5.23 Lesson Preparation

Base path: `/preparation`

#### `POST /preparation` 🔐 (TEACHER)
Create lesson preparation record for a lecture.

#### `GET /preparation` 🔐
List lesson preparations.

#### `GET /preparation/:id` 🔐
Get lesson preparation details.

#### `PATCH /preparation/:id` 🔐
Update lesson preparation.

#### `DELETE /preparation/:id` 🔐
Delete lesson preparation.

#### `POST /preparation/:id/files` 🔐
Upload attachments to lesson preparation.

#### `DELETE /preparation/:id/files/:filename` 🔐
Delete attachment from lesson preparation.

---

### 5.24 Digital Library

Base path: `/library`

#### `POST /library` 🔐
Add a new resource link to digital library.

#### `GET /library` 🔐
List library resources.

#### `GET /library/:id` 🔐
Get library resource details.

#### `PATCH /library/:id` 🔐
Update library resource.

#### `DELETE /library/:id` 🔐
Delete library resource.

---

### 5.25 Financial — Records & Student Ledgers

Base path: `/financial-records`

#### `GET /financial-records` 🛡️
List financial records for all students.

#### `GET /financial-records/me` 🔐 (STUDENT)
Get logged-in student's financial ledger.

#### `GET /financial-records/me/summary` 🔐 (STUDENT)
Get summary of dues & payments.

#### `GET /financial-records/me/trips` 🔐 (STUDENT)
Get student trip financial records.

#### `GET /financial-records/:studentId` 🛡️
Get specific student's financial record.

#### `GET /financial-records/:studentId/summary` 🛡️
Get student financial summary.

#### `POST /financial-records/:studentId/tuition/pay` 🛡️
Record a tuition fee payment.

---

### 5.26 Financial — Fee Configs

Base path: `/fee-configs`

#### `POST /fee-configs` 🛡️
Create annual tuition fee configuration.

#### `GET /fee-configs` 🛡️
List fee configurations.

#### `GET /fee-configs/:id` 🛡️
Get fee configuration details.

#### `PATCH /fee-configs/:id` 🛡️
Update fee configuration.

#### `DELETE /fee-configs/:id` 🛡️
Delete fee configuration.

---

### 5.27 Financial — Installment Plans

Base path: `/installment-plans`

#### `POST /installment-plans` 🛡️
Create tuition installment plan template.

#### `GET /installment-plans` 🛡️
List installment plans.

#### `GET /installment-plans/:id` 🛡️
Get installment plan details.

#### `PATCH /installment-plans/:id` 🛡️
Update installment plan template.

#### `PATCH /installment-plans/:id/set-default` 🛡️
Set plan as default for new enrollments.

#### `DELETE /installment-plans/:id` 🛡️
Delete installment plan template.

---

### 5.28 Financial — Discounts

Base path: `/discounts`

#### `POST /discounts` 🛡️
Create discount policy.

#### `GET /discounts` 🛡️
List discount policies.

#### `GET /discounts/:id` 🛡️
Get discount policy details.

#### `PATCH /discounts/:id` 🛡️
Update discount policy.

#### `DELETE /discounts/:id` 🛡️
Delete discount policy.

#### `POST /discounts/apply/tuition/:studentId` 🛡️
Apply discount to student tuition.

#### `DELETE /discounts/apply/tuition/:studentId` 🛡️
Remove discount from student tuition.

#### `POST /discounts/apply/bus/:studentId` 🛡️
Apply discount to student bus fee.

#### `DELETE /discounts/apply/bus/:studentId` 🛡️
Remove discount from student bus fee.

#### `POST /discounts/apply/trips/:studentId/:tripId` 🛡️
Apply discount to student trip fee.

#### `DELETE /discounts/apply/trips/:studentId/:tripId` 🛡️
Remove discount from student trip fee.

---

### 5.29 Financial — Additional Fees

Base path: `/additional-fees`

#### `POST /additional-fees` 🛡️
Create an additional fee (books, uniform, exam fees).

#### `GET /additional-fees` 🛡️
List additional fees.

#### `GET /additional-fees/:id` 🛡️
Get additional fee details.

#### `DELETE /additional-fees/:id` 🛡️
Delete additional fee.

#### `POST /additional-fees/:feeId/pay/:studentId` 🛡️
Record student payment for additional fee.

---

### 5.30 Financial — Bus Subscription Module

Base path: `/bus-subscriptions` & `/bus`

#### `GET /bus-subscriptions` 🛡️
List all bus subscription records.

#### `GET /bus-subscriptions/candidates` 🛡️
List students eligible for bus enrollment.

#### `GET /bus-subscriptions/me` 🔐 (STUDENT)
Get student's own bus subscription status.

#### `GET /bus-subscriptions/:studentId` 🛡️
Get specific student's bus subscription.

#### `POST /bus-subscriptions/:studentId/enroll` 🛡️
Enroll student in bus service (`pickup`, `dropoff`, `both`).

#### `POST /bus-subscriptions/:studentId/pay` 🛡️
Record bus fee payment.

#### `DELETE /bus-subscriptions/:studentId/unenroll` 🛡️
Unenroll student from bus service.

#### `POST /bus/enroll` 🛡️
Legacy bus enrollment endpoint.

#### `GET /bus` 🛡️
Legacy list bus subscriptions endpoint.

#### `POST /bus/pay` 🛡️
Legacy bus payment endpoint.

#### `DELETE /bus/unenroll` 🛡️
Legacy unenroll endpoint.

---

### 5.31 Financial — Trips Subscription Module

Base path: `/trip-subscriptions` & `/trips`

#### `POST /trip-subscriptions` 🛡️
Create a new school trip event template.

#### `GET /trip-subscriptions` 🛡️
List all trip templates.

#### `GET /trip-subscriptions/:tripTemplateId` 🛡️
Get trip template details.

#### `GET /trip-subscriptions/:tripTemplateId/students` 🛡️
List students registered for trip.

#### `GET /trip-subscriptions/:tripTemplateId/candidates` 🛡️
List candidates eligible for trip.

#### `POST /trip-subscriptions/:tripTemplateId/students/:studentId/register` 🛡️
Register student for trip.

#### `POST /trip-subscriptions/:tripTemplateId/students/:studentId/pay` 🛡️
Record payment for trip.

#### `DELETE /trip-subscriptions/:tripTemplateId/students/:studentId/unregister` 🛡️
Unregister student from trip.

#### `DELETE /trip-subscriptions/:tripTemplateId` 🛡️
Delete trip template.

#### `POST /trips` 🛡️
Legacy create trip endpoint.

#### `GET /trips` 🛡️
Legacy list trips endpoint.

#### `POST /trips/register` 🛡️
Legacy trip registration endpoint.

#### `POST /trips/pay` 🛡️
Legacy trip payment endpoint.

---

### 5.32 Expenses — Categories

Base path: `/expense-categories`

#### `POST /expense-categories` 🛡️
Create expense category (salaries, utilities, maintenance).

#### `GET /expense-categories` 🛡️
List expense categories.

#### `GET /expense-categories/:id` 🛡️
Get category details.

#### `PATCH /expense-categories/:id` 🛡️
Update expense category.

#### `DELETE /expense-categories/:id` 🛡️
Delete expense category.

---

### 5.33 Expenses

Base path: `/expenses`

#### `POST /expenses` 🛡️
Log a new operational expense.

#### `GET /expenses` 🛡️
List operational expenses with pagination and filtering.

#### `GET /expenses/:id` 🛡️
Get expense record details.

#### `PATCH /expenses/:id` 🛡️
Update expense record.

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
  "timestamp": "2026-07-30T14:05:00.000Z"
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
