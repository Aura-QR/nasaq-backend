# Aura School System — API Documentation

> **Version:** 1.0  
> **Framework:** NestJS + Mongoose (MongoDB)  
> **Live Swagger UI:** `http://localhost:3000/api/docs`  
> **Base URL:** `http://localhost:3000`  
> **Last Updated:** 2026-07-21

---

## Table of Contents

1. [Architecture & Domains Overview](#1-architecture--domains-overview)
2. [Global Configuration](#2-global-configuration)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Database Schemas Dictionary](#4-database-schemas-dictionary)
5. [Complete API Endpoints Reference](#5-complete-api-endpoints-reference)
6. [Standard Response Envelope](#6-standard-response-envelope)
7. [Environment Variables](#7-environment-variables)

---

## 1. Architecture & Domains Overview

The Aura School System is organized into the following NestJS feature modules:

| Module | Description |
|---|---|
| **Auth** | JWT-based login for all user types (Admin, Teacher, Student) |
| **Admin** | Admin account management + admin-specific login |
| **Students** | Full student lifecycle: CRUD, password setup, OTP flow |
| **Teachers** | Teacher management, subject assignment, profile access |
| **Classes** | Classroom management, student enrollment, teacher-in-charge |
| **Subjects** | Academic subjects, many-to-many relationship with classes |
| **Attendance** | Absence tracking per student/class/date |
| **Lectures** | Weekly schedule slots (day + slot per class/subject/teacher) |
| **Exams** | Online exam management, questions, grading, results |
| **Grades Criteria** | Grade distribution rules per subject |
| **Projects** | File-based project assignments with student submissions |
| **Preparation** | Teacher lesson preparation files linked to lectures |
| **Library** | External resource links linked to subjects |
| **Financial** | Complete tuition/bus/trip/discount/installment financial system |
| **Expenses** | School operating expenses with categories |
| **CASL** | Ability-based authorization (`@CheckAbilities`) |
| **Tasks** | Background scheduled tasks |

### Role System

```
ADMIN    → Full access to all resources
TEACHER  → Read classes they teach; create/grade exams and projects
STUDENT  → Read their own data (profile, grades, schedule, exams)
```

---

## 2. Global Configuration

| Setting | Value |
|---|---|
| **Validation** | `ValidationPipe` — `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` |
| **CORS** | Enabled for all origins (`*`) |
| **Response Format** | Wrapped by a global `ResponseInterceptor` |
| **Error Format** | Handled by a global `GlobalExceptionFilter` |
| **Auth Strategy** | JWT Bearer Token (`Authorization: Bearer <token>`) |

---

## 3. Authentication & Authorization

### Guards in Use

| Guard | Purpose |
|---|---|
| `JwtAuthGuard` | Verifies the JWT token; injects `@CurrentUser()` |
| `AbilitiesGuard` | CASL-based resource/action authorization |
| `RolesGuard` | Role-based guard used in some financial endpoints |

### JWT Token

All protected endpoints require:

```
Authorization: Bearer <jwt_token>
```

The token is obtained via `POST /auth/login` or `POST /admin/login`. It contains:

```json
{
  "userId": "ObjectId",
  "role": "ADMIN | TEACHER | STUDENT"
}
```

### Endpoint Protection Legend

| Symbol | Meaning |
|---|---|
| 🔓 | Public — no authentication required |
| 🔐 | Requires `JwtAuthGuard` (any valid JWT) |
| 🛡️ | Requires `JwtAuthGuard` + CASL `AbilitiesGuard` |

---

## 4. Database Schemas Dictionary

### 4.1 `admins` Collection

| Field | Type | Required | Unique | Default | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | Auto | ✅ | — | MongoDB document ID |
| `username` | String | ✅ | ✅ | — | Min 3 chars |
| `email` | String | ✅ | ✅ | — | Valid email format |
| `password` | String | ✅ | — | — | Hashed (bcrypt) |
| `role` | String | — | — | `"ADMIN"` | Fixed value |
| `createdAt` | Date | Auto | — | — | Timestamp |
| `updatedAt` | Date | Auto | — | — | Timestamp |

---

### 4.2 `students` Collection

| Field | Type | Required | Unique | Default | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | Auto | ✅ | — | |
| `firstName` | String | ✅ | — | — | |
| `familyName` | String | ✅ | — | — | |
| `fatherName` | String | ✅ | — | — | |
| `name` | String | Auto | — | — | Computed: `firstName + fatherName + familyName` (pre-save hook) |
| `birthDate` | Date | ✅ | — | — | |
| `gender` | String | ✅ | — | — | Enum: `"male"` \| `"female"` |
| `nationality` | String | ✅ | — | — | |
| `academicYear` | String | ✅ | — | — | e.g. `"2024-2025"` |
| `phoneNumber` | String | ✅ | — | — | Indexed; digits/spaces/+/- only |
| `email` | String | ✅ | ✅ | — | Indexed |
| `schoolEmail` | String | — | ✅ | — | Auto-generated school email; indexed |
| `address` | String | ✅ | — | — | |
| `previousSchool` | String | — | — | — | Optional |
| `registrationDate` | Date | — | — | `Date.now` | |
| `notes` | String | — | — | — | Optional |
| `classId` | ObjectId → Class | — | — | `null` | |
| `installmentPlanId` | ObjectId → InstallmentPlan | — | — | `null` | |
| `isActive` | Boolean | — | — | `true` | |
| `role` | String | — | — | `"STUDENT"` | |
| `password` | String | — | — | — | `select: false`; hashed |
| `hasPassword` | Boolean | — | — | `false` | True once OTP setup done |
| `otp` | String | — | — | — | `select: false` |
| `otpExpiry` | Date | — | — | — | `select: false` |
| `createdAt` | Date | Auto | — | — | |
| `updatedAt` | Date | Auto | — | — | |

---

### 4.3 `teachers` Collection

| Field | Type | Required | Unique | Default | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | Auto | ✅ | — | |
| `name` | String | ✅ | — | — | Min 2 chars |
| `email` | String | ✅ | ✅ | — | Indexed |
| `phoneNumber` | String | — | — | — | Indexed; optional |
| `subjectIds` | ObjectId[] → Subject | ✅ | — | `[]` | Must have at least 1 subject |
| `qualification` | String | — | — | — | e.g. `"Bachelor's in Math"` |
| `experience` | String | — | — | — | e.g. `"5 years"` |
| `specialization` | String | — | — | — | e.g. `"Secondary Education"` |
| `hireDate` | Date | ✅ | — | — | ISO date string |
| `address` | String | — | — | — | Optional |
| `isActive` | Boolean | ✅ | — | — | |
| `isInCharge` | Boolean | — | — | `false` | |
| `role` | String | — | — | `"TEACHER"` | |
| `password` | String | ✅ | — | — | Hashed (bcrypt) |
| `createdAt` | Date | Auto | — | — | |
| `updatedAt` | Date | Auto | — | — | |

---

### 4.4 `classes` Collection

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `academicYear` | String | ✅ | — | e.g. `"2024-2025"` |
| `gender` | String | ✅ | — | Enum: `"male"` \| `"female"` |
| `subjectIds` | ObjectId[] → Subject | — | `[]` | |
| `studentIds` | ObjectId[] → Student | — | `[]` | |
| `teacherInChargeId` | ObjectId → Teacher | — | `null` | |
| `roomNumber` | String | ✅ | — | |
| `maxCapacity` | Number | ✅ | — | |
| `isActive` | Boolean | ✅ | `true` | |
| `currentEnrollment` | Number (virtual) | Auto | — | `studentIds.length` |
| `availableSeats` | Number (virtual) | Auto | — | `maxCapacity - currentEnrollment` |
| `createdAt` | Date | Auto | — | |
| `updatedAt` | Date | Auto | — | |

---

### 4.5 `subjects` Collection

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `subjectName` | String | ✅ | — | |
| `subjectCode` | String | — | — | Optional |
| `classIds` | ObjectId[] → Class | — | `[]` | Many-to-many |

---

### 4.6 `attendance` Collection

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `studentId` | ObjectId → Student | ✅ | — | Indexed |
| `classId` | ObjectId → Class | ✅ | — | Indexed |
| `date` | Date | ✅ | — | Absence date |
| `name` | String | — | — | Indexed; student name snapshot |
| `createdAt` | Date | Auto | — | |
| `updatedAt` | Date | Auto | — | |

---

### 4.7 `lectures` Collection (Schedule)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `classId` | ObjectId → Class | ✅ | — | Indexed |
| `subjectId` | ObjectId → Subject | ✅ | — | Indexed |
| `teacherId` | ObjectId → Teacher | ✅ | — | Indexed |
| `dayOfWeek` | String | ✅ | — | `"Sunday"` – `"Thursday"` |
| `slot` | Number | ✅ | — | Min: 1, Max: 10 (period number) |
| `preparation` | ObjectId[] → Preparation | — | `[]` | |
| `createdAt` | Date | Auto | — | |
| `updatedAt` | Date | Auto | — | |

---

### 4.8 `exams` Collection

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | Auto | |
| `gradesCriteriaId` | ObjectId → GradesCriteria | ✅ | Indexed |
| `subjectId` | ObjectId → Subject | ✅ | Indexed |
| `academicYear` | String | ✅ | |
| `classIds` | ObjectId[] → Class | ✅ | Indexed |
| `examType` | String | ✅ | Enum: `"quiz"` \| `"assignment"` \| `"activity"` \| `"final"` |
| `grade` | Number | ✅ | Max grade |
| `createdBy` | ObjectId → Teacher | ✅ | Indexed |
| `startDate` | Date | ✅ | Exam window opens |
| `endDate` | Date | ✅ | Exam window closes |
| `duration` | Number | ✅ | In minutes; min: 1 |
| `questions[].question` | String | ✅ | |
| `questions[].options` | String[] | ✅ | |
| `questions[].correctAnswer` | String | ✅ | |
| `createdAt` | Date | Auto | |
| `updatedAt` | Date | Auto | |

---

### 4.9 `gradesCriteria` Collection

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | Auto | |
| `subjectId` | ObjectId → Subject | ✅ | Indexed |
| `academicYear` | String | ✅ | |
| `final` | Number | ✅ | Grade weight for final exam |
| `assignments` | Number | ✅ | Weight per assignment |
| `assignmentsCount` | Number | ✅ | Min: 1 |
| `activities` | Number | ✅ | Weight per activity |
| `projects` | Number | ✅ | Weight per project |
| `projectsCount` | Number | ✅ | Min: 1 |
| `quizzes` | Number | ✅ | Weight per quiz |
| `quizzesCount` | Number | ✅ | Min: 1 |
| `createdAt` | Date | Auto | |
| `updatedAt` | Date | Auto | |

---

### 4.10 `library` Collection

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `title` | String | ✅ | — | |
| `link` | String | ✅ | — | URL to external resource |
| `subjectId` | ObjectId → Subject | — | `null` | Optional |
| `academicYear` | String | — | — | Optional, e.g. `"2024-2025"` |

---

### 4.11 `feeConfigs` Collection

| Field | Type | Required | Unique | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | ✅ | |
| `academicYear` | String | ✅ | ✅ | One config per year; indexed |
| `tuitionFee` | Number | ✅ | — | Min: 0 |
| `createdBy` | ObjectId → Admin | ✅ | — | |
| `createdAt` | Date | Auto | — | |
| `updatedAt` | Date | Auto | — | |

---

### 4.12 `installmentPlans` Collection

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | Auto | — | |
| `name` | String | ✅ | — | |
| `description` | String | — | — | |
| `numberOfInstallments` | Number | ✅ | — | Min: 1 |
| `dueDates` | Date[] | ✅ | — | Array of due dates |
| `isDefault` | Boolean | — | `false` | |
| `isActive` | Boolean | — | `true` | |
| `createdBy` | ObjectId → Admin | ✅ | — | |
| `createdAt` | Date | Auto | — | |
| `updatedAt` | Date | Auto | — | |

---

### 4.13 `studentFinancialRecords` Collection

Central financial document per student per academic year.

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | Auto | |
| `studentId` | ObjectId → Student | ✅ | Indexed; unique per `studentId + academicYear` |
| `academicYear` | String | ✅ | |
| `classId` | ObjectId → Class | ✅ | |
| `feeConfigId` | ObjectId → FeeConfig | ✅ | |
| `installmentPlanId` | ObjectId → InstallmentPlan | — | `null` = single full payment |
| `tuition.fee` | Number | ✅ | Original tuition amount |
| `tuition.discount` | DiscountSnapshot \| null | — | Applied discount |
| `tuition.netFee` | Number | — | `fee - discountAmount` |
| `tuition.status` | String | — | `"unpaid"` \| `"partial"` \| `"paid"` |
| `tuition.installments[]` | Installment[] | — | Each with `amount`, `dueDate`, `status`, `paidAmount`, `payments[]` |
| `bus.enrolled` | Boolean | — | Default: `false` |
| `bus.serviceType` | String | — | `"pickup"` \| `"dropoff"` \| `"both"` |
| `bus.fee` | Number | — | |
| `trips[]` | TripRecord[] | — | Per-trip financial data |
| `additionalFees[]` | StudentAdditionalFee[] | — | Extra fee assignments |

---

## 5. Complete API Endpoints Reference

> **Pagination**: All list endpoints support `?page=1&limit=10` query parameters.

---

### 5.1 Auth

Base path: `/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | 🔓 | Login for Teachers and Students |

#### `POST /auth/login`

```json
{
  "identifier": "john.doe@school.com",
  "password": "secret123"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `identifier` | String | ✅ | Min 3 chars; username or email |
| `password` | String | ✅ | Min 6 chars |

**Response `200`:**

```json
{
  "token": "eyJhbGci...",
  "user": { "userId": "...", "role": "TEACHER" }
}
```

---

### 5.2 Admin

Base path: `/admin`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/admin/register` | 🔓 | Register a new admin account |
| `POST` | `/admin/login` | 🔓 | Admin login (returns JWT) |
| `GET` | `/admin` | 🔓 | Get all admins |
| `GET` | `/admin/:id` | 🔓 | Get admin by ID |
| `PATCH` | `/admin/:id` | 🔓 | Update admin details |
| `DELETE` | `/admin/:id` | 🔓 | Delete an admin |

#### `POST /admin/register`

```json
{
  "username": "admin_ali",
  "email": "ali@school.com",
  "password": "Admin@123"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `username` | String | ✅ | Min 3 chars |
| `email` | String | ✅ | Valid email |
| `password` | String | ✅ | Min 6 chars |

**Errors:** `409 Conflict` if username or email already exists.

#### `POST /admin/login`

```json
{
  "identifier": "admin_ali",
  "password": "Admin@123"
}
```

---

### 5.3 Students

Base path: `/students`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/students` | 🔓 | Create a new student |
| `GET` | `/students` | 🔓 | List students (paginated + filterable) |
| `GET` | `/students/list` | 🔓 | Simplified list for dropdowns |
| `GET` | `/students/me` | 🔐 | Get authenticated student's own profile |
| `GET` | `/students/:id` | 🔓 | Get student by ID |
| `PATCH` | `/students/:id` | 🔓 | Update student |
| `PATCH` | `/students/:id/toggle-active` | 🔓 | Toggle active status |
| `DELETE` | `/students/:id` | 🔓 | Delete student |
| `POST` | `/students/request-password-setup` | 🔓 | Send OTP to student email |
| `POST` | `/students/set-password` | 🔓 | Set password using OTP |

#### `POST /students` — Create Student

```json
{
  "firstName": "Ahmed",
  "familyName": "Hassan",
  "fatherName": "Mohamed",
  "birthDate": "2010-05-15",
  "gender": "male",
  "nationality": "Egyptian",
  "academicYear": "2024-2025",
  "phoneNumber": "+20 1234567890",
  "email": "ahmed.parent@gmail.com",
  "address": "123 Nile Street, Cairo",
  "previousSchool": "Cairo Primary School",
  "registrationDate": "2026-01-01",
  "notes": "Allergic to peanuts",
  "classId": "6650a1b2c3d4e5f6a7b8c9d0",
  "installmentPlanId": "6650a1b2c3d4e5f6a7b8c9d1",
  "isActive": true,
  "password": "Student@123"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `firstName` | String | ✅ | Min 2 chars |
| `familyName` | String | ✅ | Min 2 chars |
| `fatherName` | String | ✅ | Min 2 chars |
| `birthDate` | String | ✅ | ISO date string |
| `gender` | String | ✅ | `"male"` \| `"female"` |
| `nationality` | String | ✅ | |
| `academicYear` | String | ✅ | |
| `phoneNumber` | String | ✅ | Digits, spaces, `+`, `-`, `()` only |
| `email` | String | ✅ | Valid email |
| `address` | String | ✅ | |
| `previousSchool` | String | ❌ | |
| `registrationDate` | String | ❌ | ISO date string |
| `notes` | String | ❌ | |
| `classId` | String | ❌ | MongoDB ObjectId |
| `installmentPlanId` | String | ❌ | MongoDB ObjectId; omit for single payment |
| `isActive` | Boolean | ❌ | Default: `true` |
| `password` | String | ❌ | Min 6 chars; defaults to `schoolEmail` if omitted |

#### `POST /students/request-password-setup`

```json
{ "email": "ahmed.parent@gmail.com" }
```

#### `POST /students/set-password`

```json
{
  "email": "ahmed.parent@gmail.com",
  "otp": "123456",
  "password": "NewPass@123"
}
```

---

### 5.4 Teachers

Base path: `/teachers`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/teachers` | 🔓 | Create a new teacher |
| `GET` | `/teachers` | 🔓 | List teachers (paginated + filterable) |
| `GET` | `/teachers/list` | 🔓 | Simplified list for dropdowns |
| `GET` | `/teachers/me` | 🛡️ | Get authenticated teacher's profile |
| `GET` | `/teachers/by-subject/:subjectId` | 🔓 | Get teachers for a specific subject |
| `GET` | `/teachers/:id` | 🔓 | Get teacher by ID |
| `PATCH` | `/teachers/:id` | 🔓 | Update teacher |
| `PATCH` | `/teachers/:id/toggle-active` | 🔓 | Toggle active status |
| `DELETE` | `/teachers/:id` | 🔓 | Delete teacher |

#### `POST /teachers` — Create Teacher

```json
{
  "name": "Dr. Fatima Ali",
  "email": "fatima.ali@school.com",
  "phoneNumber": "+20 1098765432",
  "subjectIds": ["6650a1b2c3d4e5f6a7b8c9d0"],
  "qualification": "PhD in Physics",
  "experience": "10+ years",
  "specialization": "Secondary Education",
  "hireDate": "2020-09-01",
  "address": "45 University Road, Alexandria",
  "isActive": true,
  "password": "Teacher@123"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | String | ✅ | Min 2 chars |
| `email` | String | ✅ | Valid email |
| `phoneNumber` | String | ❌ | International phone format |
| `subjectIds` | String[] | ✅ | Array of ObjectIds; min 1 item |
| `qualification` | String | ❌ | |
| `experience` | String | ❌ | |
| `specialization` | String | ❌ | |
| `hireDate` | String | ✅ | ISO date string |
| `address` | String | ❌ | |
| `isActive` | Boolean | ✅ | |
| `password` | String | ✅ | Min 6 chars |

---

### 5.5 Classes

Base path: `/classes`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/classes` | 🔓 | Create a new class |
| `GET` | `/classes` | 🔓 | List classes (paginated + filterable) |
| `GET` | `/classes/list` | 🔓 | Simplified list for dropdowns |
| `GET` | `/classes/my-classes` | 🔐 | Classes the authenticated teacher teaches |
| `GET` | `/classes/student/me` | 🔐 | The authenticated student's class |
| `GET` | `/classes/student/me/mates` | 🔐 | The authenticated student's classmates |
| `GET` | `/classes/:id` | 🔓 | Get class by ID |
| `GET` | `/classes/:id/students` | 🔓 | Get all students in a class |
| `PATCH` | `/classes/:id` | 🔓 | Update class details |
| `PATCH` | `/classes/:id/toggle-active` | 🔓 | Toggle active status |
| `PATCH` | `/classes/:id/add-student/:studentId` | 🔓 | Add a student to a class |
| `PATCH` | `/classes/:id/remove-student/:studentId` | 🔓 | Remove a student from a class |
| `DELETE` | `/classes/:id` | 🔓 | Delete class |

#### `POST /classes` — Create Class

```json
{
  "academicYear": "2024-2025",
  "gender": "male",
  "subjectIds": ["6650a1b2c3d4e5f6a7b8c9d0"],
  "teacherInChargeId": "6650a1b2c3d4e5f6a7b8c9d1",
  "roomNumber": "A101",
  "maxCapacity": 35,
  "isActive": true
}
```

---

### 5.6 Subjects

Base path: `/subjects`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/subjects` | 🔓 | Create a new subject |
| `GET` | `/subjects` | 🔐 | List subjects (paginated + filterable) — role-aware |
| `GET` | `/subjects/list` | 🔓 | Simplified list for dropdowns |
| `GET` | `/subjects/student/me` | 🔐 | Subjects for the authenticated student |
| `GET` | `/subjects/teacher/me` | 🔐 | Subjects taught by the authenticated teacher |
| `GET` | `/subjects/:id` | 🔓 | Get subject by ID |
| `PATCH` | `/subjects/:id` | 🔓 | Update subject |
| `DELETE` | `/subjects/:id` | 🔓 | Delete subject |

#### `POST /subjects`

```json
{
  "subjectName": "Mathematics",
  "subjectCode": "MATH-101",
  "classIds": ["6650a1b2c3d4e5f6a7b8c9d0"]
}
```

---

### 5.7 Attendance

Base path: `/attendance`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/attendance` | 🔓 | Record an absence (mark student absent) |
| `GET` | `/attendance` | 🔓 | List records (filterable by `studentId`, `classId`, `date`) |
| `GET` | `/attendance/student/me` | 🔐 | Authenticated student's own absence records |
| `PATCH` | `/attendance/:id` | 🔓 | Update an attendance record |
| `DELETE` | `/attendance/:id` | 🔓 | Delete an attendance record |

#### `POST /attendance`

```json
{
  "studentId": "6650a1b2c3d4e5f6a7b8c9d0",
  "classId": "6650a1b2c3d4e5f6a7b8c9d1",
  "date": "2026-07-21"
}
```

---

### 5.8 Lectures

Base path: `/lectures`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/lectures` | 🔓 | Create a lecture (schedule slot) |
| `GET` | `/lectures` | 🛡️ | List lectures (role-aware) |
| `GET` | `/lectures/student/me` | 🔐 | Weekly schedule for authenticated student |
| `GET` | `/lectures/teacher/me/classes` | 🔐 | Classes the authenticated teacher teaches |
| `GET` | `/lectures/student/:id` | 🔓 | All lectures for a specific student |
| `GET` | `/lectures/:id` | 🔓 | Get lecture by ID |
| `PATCH` | `/lectures/:id` | 🔓 | Update lecture |
| `DELETE` | `/lectures/:id` | 🔓 | Delete lecture |

#### `POST /lectures`

```json
{
  "classId": "6650a1b2c3d4e5f6a7b8c9d0",
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d1",
  "teacherId": "6650a1b2c3d4e5f6a7b8c9d2",
  "dayOfWeek": "Sunday",
  "slot": 1
}
```

#### `GET /lectures/teacher/me/classes` — Query Parameters

| Param | Type | Required |
|---|---|---|
| `subjectId` | String | ❌ |

---

### 5.9 Exams

Base path: `/exams`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Who Can | Description |
|---|---|---|---|
| `POST` | `/exams` | Teacher | Create exam |
| `GET` | `/exams` | Admin/Teacher | List all exams (role-filtered) |
| `GET` | `/exams/student/me` | Student | Get student's exams |
| `GET` | `/exams/:id` | All | Get exam by ID |
| `PATCH` | `/exams/:id` | Teacher | Update exam |
| `DELETE` | `/exams/:id` | Teacher/Admin | Delete exam |
| `DELETE` | `/exams/deleteAll` | Admin | Delete all exams |
| `POST` | `/exams/:examId/questions` | Teacher | Add question |
| `PATCH` | `/exams/:examId/questions/:questionId` | Teacher | Update question |
| `DELETE` | `/exams/:examId/questions/:questionId` | Teacher | Delete question |
| `POST` | `/exams/:examId/start` | Student | Start exam, get remaining seconds |
| `POST` | `/exams/:examId/grade` | Student | Submit answers for grading |
| `PATCH` | `/exams/:examId/students/:studentId/grade` | Teacher | Manually edit a student's grade |

#### `POST /exams` — Create Exam

```json
{
  "gradesCriteriaId": "6650a1b2c3d4e5f6a7b8c9d0",
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d1",
  "academicYear": "2024-2025",
  "classIds": ["6650a1b2c3d4e5f6a7b8c9d2"],
  "examType": "quiz",
  "grade": 10,
  "startDate": "2026-07-22T09:00:00.000Z",
  "endDate": "2026-07-22T10:00:00.000Z",
  "duration": 45,
  "questions": [
    {
      "question": "What is the capital of France?",
      "options": ["London", "Paris", "Berlin", "Madrid"],
      "correctAnswer": "Paris"
    }
  ]
}
```

#### `POST /exams/:examId/grade` — Submit Answers

```json
{
  "answers": [
    { "questionId": "6650a1b2c3d4e5f6a7b8c9d0", "answer": "Paris" }
  ]
}
```

**Response includes:** `examId`, `examType`, `totalQuestions`, `correctAnswers`, `percentage`, `maxGrade`, `achievedGrade`, `results[]`, `passed`.

#### `GET /exams/student/me` — Query Parameters

| Param | Type | Description |
|---|---|---|
| `examType` | String | `quiz` \| `assignment` \| `activity` \| `final` |
| `academicYear` | String | |
| `subjectId` | ObjectId | |
| `gradesCriteriaId` | ObjectId | |
| `status` | String | `upcoming` \| `available` \| `expired` |

---

### 5.10 Grades Criteria

Base path: `/gradesCriteria`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/gradesCriteria` | 🔓 | Create grading criteria |
| `GET` | `/gradesCriteria` | 🛡️ | List all criteria (role-filtered) |
| `GET` | `/gradesCriteria/student/me` | 🔐 | Criteria for authenticated student |
| `GET` | `/gradesCriteria/student/me/subjects` | 🔐 | Subjects of authenticated student |
| `GET` | `/gradesCriteria/student/me/grades` | 🔐 | Grades for authenticated student (requires `?subjectId=`) |
| `GET` | `/gradesCriteria/:id` | 🔓 | Get by ID |
| `PATCH` | `/gradesCriteria/:id` | 🔓 | Update criteria |
| `DELETE` | `/gradesCriteria/:id` | 🔓 | Delete criteria |

#### `POST /gradesCriteria`

```json
{
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYear": "2024-2025",
  "final": 50,
  "assignments": 5,
  "assignmentsCount": 3,
  "activities": 10,
  "projects": 15,
  "projectsCount": 2,
  "quizzes": 5,
  "quizzesCount": 4
}
```

---

### 5.11 Projects

Base path: `/projects`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**  
**File uploads use `Content-Type: multipart/form-data`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/projects` | 🛡️ | Create project with files (Teacher) |
| `GET` | `/projects` | 🛡️ | List all projects (role-aware) |
| `GET` | `/projects/teacher/me` | 🔐 | Projects created by the authenticated teacher |
| `GET` | `/projects/student/me` | 🔐 | Projects for the authenticated student |
| `GET` | `/projects/submissions` | 🔐 | Teacher lists submissions by subject + class |
| `DELETE` | `/projects/deleteAll` | 🛡️ | Delete all projects (Admin) |
| `GET` | `/projects/:id` | 🛡️ | Get project by ID |
| `GET` | `/projects/:id/download` | 🔐 | Download project files as ZIP |
| `PATCH` | `/projects/:id` | 🛡️ | Update project |
| `DELETE` | `/projects/:id` | 🛡️ | Delete project |
| `POST` | `/projects/:id/files` | 🛡️ | Add files to project |
| `DELETE` | `/projects/:id/files/:filename` | 🛡️ | Remove a file from project |
| `POST` | `/projects/:projectId/submit` | 🔐 | Student uploads submission files |
| `DELETE` | `/projects/:projectId/submit/files/:filename` | 🔐 | Student removes submission file |
| `GET` | `/projects/:projectId/my-submission` | 🔐 | Student views their own submission |
| `GET` | `/projects/:projectId/submissions` | 🔐 | Teacher lists all submissions |
| `GET` | `/projects/:projectId/submissions/:studentId/download` | 🔐 | Teacher downloads student submission as ZIP |
| `PATCH` | `/projects/:projectId/submissions/:studentId/grade` | 🔐 | Teacher grades a student submission |

#### `POST /projects` — Create Project (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `classIds` | String[] | ✅ | Array of class ObjectIds |
| `subjectId` | String | ✅ | ObjectId |
| `academicYear` | String | ✅ | |
| `title` | String | ✅ | |
| `description` | String | ✅ | |
| `dueDate` | String | ✅ | ISO 8601 datetime |
| `files` | File[] | ❌ | Max 10 files, 20MB each |

#### `GET /projects/submissions` — Query Parameters

| Param | Type | Required |
|---|---|---|
| `subjectId` | ObjectId | ✅ |
| `classId` | ObjectId | ✅ |

#### `PATCH /projects/:projectId/submissions/:studentId/grade`

```json
{ "achievedGrade": 18.5 }
```

---

### 5.12 Preparation

Base path: `/preparation`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**  
**File uploads use `Content-Type: multipart/form-data`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/preparation` | 🛡️ | Create preparation with files for a lecture |
| `GET` | `/preparation` | 🛡️ | List preparations (filterable by `lecture`) |
| `GET` | `/preparation/:id` | 🛡️ | Get preparation by ID |
| `PATCH` | `/preparation/:id` | 🛡️ | Update preparation |
| `DELETE` | `/preparation/:id` | 🛡️ | Delete preparation |
| `POST` | `/preparation/:id/files` | 🛡️ | Add files to a preparation |
| `DELETE` | `/preparation/:id/files/:filename` | 🛡️ | Remove a file from preparation |

#### `POST /preparation` — (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `lecture` | String | ✅ | Lecture ID (ObjectId) |
| `files` | File[] | ❌ | Max 10 files, 20MB each |

---

### 5.13 Library

Base path: `/library`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/library` | 🔓 | Create a library resource link |
| `GET` | `/library` | 🔓 | List library items (paginated + filterable) |
| `GET` | `/library/list` | 🔓 | Simplified list for dropdowns |
| `PATCH` | `/library/:id` | 🔓 | Update a library item |
| `DELETE` | `/library/:id` | 🔓 | Delete a library item |

#### `POST /library`

```json
{
  "title": "Khan Academy - Algebra",
  "link": "https://www.khanacademy.org/math/algebra",
  "subjectId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYear": "2024-2025"
}
```

---

### 5.14 Financial — Records

Base path: `/financial/records`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/financial/records` | 🛡️ | List all financial records (Admin) |
| `GET` | `/financial/records/me` | 🔐 | Student's own financial record |
| `GET` | `/financial/records/me/summary` | 🔐 | Student's installment summary |
| `GET` | `/financial/records/me/trips` | 🔐 | Student's trips overview |
| `GET` | `/financial/records/:studentId` | 🛡️ | Full financial record for a student |
| `GET` | `/financial/records/:studentId/summary` | 🛡️ | Installment summary for a student |
| `POST` | `/financial/records/:studentId/tuition/pay` | 🛡️ | Record a tuition installment payment |

#### `GET /financial/records` — Filter Parameters

| Param | Type |
|---|---|
| `academicYear` | String |
| `classId` | ObjectId |
| `studentName` | String |
| `tuitionStatus` | `unpaid` \| `partial` \| `paid` |

#### `POST /financial/records/:studentId/tuition/pay`

```json
{
  "amount": 5000,
  "paidAt": "2026-07-21T10:00:00.000Z",
  "notes": "Received in cash at front desk"
}
```

---

### 5.15 Financial — Fee Configs

Base path: `/financial/fee-configs`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/financial/fee-configs` | 🛡️ | Create fee config for an academic year |
| `GET` | `/financial/fee-configs` | 🛡️ | List all fee configurations |
| `GET` | `/financial/fee-configs/:id` | 🛡️ | Get fee config by ID |
| `PATCH` | `/financial/fee-configs/:id` | 🛡️ | Update fee config |
| `DELETE` | `/financial/fee-configs/:id` | 🛡️ | Delete (blocked if used by students) |

#### `POST /financial/fee-configs`

```json
{
  "academicYear": "2024-2025",
  "tuitionFee": 20000
}
```

---

### 5.16 Financial — Installment Plans

Base path: `/financial/installment-plans`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/financial/installment-plans` | 🛡️ | Create an installment plan template |
| `GET` | `/financial/installment-plans` | 🛡️ | List all installment plans |
| `GET` | `/financial/installment-plans/:id` | 🛡️ | Get by ID |
| `PATCH` | `/financial/installment-plans/:id` | 🛡️ | Update plan |
| `PATCH` | `/financial/installment-plans/:id/set-default` | 🛡️ | Set as system default |
| `DELETE` | `/financial/installment-plans/:id` | 🛡️ | Delete (blocked if used by students) |

#### `POST /financial/installment-plans`

```json
{
  "name": "Three Installments",
  "description": "Paid across 3 terms",
  "numberOfInstallments": 3,
  "dueDates": ["2024-09-01", "2025-01-01", "2025-04-01"]
}
```

---

### 5.17 Financial — Discounts

Base path: `/financial/discounts`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/financial/discounts` | 🛡️ | Create a discount template |
| `GET` | `/financial/discounts` | 🛡️ | List all discount templates |
| `GET` | `/financial/discounts/:id` | 🛡️ | Get by ID |
| `PATCH` | `/financial/discounts/:id` | 🛡️ | Update template |
| `DELETE` | `/financial/discounts/:id` | 🛡️ | Delete template |
| `POST` | `/financial/discounts/apply/tuition/:studentId` | 🛡️ | Apply discount to student tuition |
| `DELETE` | `/financial/discounts/apply/tuition/:studentId` | 🛡️ | Remove discount from student tuition |
| `POST` | `/financial/discounts/apply/bus/:studentId` | 🛡️ | Apply discount to student bus fee |
| `DELETE` | `/financial/discounts/apply/bus/:studentId` | 🛡️ | Remove discount from student bus fee |
| `POST` | `/financial/discounts/apply/trips/:studentId/:tripId` | 🛡️ | Apply discount to a student trip |
| `DELETE` | `/financial/discounts/apply/trips/:studentId/:tripId` | 🛡️ | Remove discount from a student trip |

#### Apply Discount Request Body

```json
{ "discountId": "6650a1b2c3d4e5f6a7b8c9d0" }
```

---

### 5.18 Financial — Additional Fees

Base path: `/financial/additional-fees`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/financial/additional-fees` | 🛡️ | Create additional fee — auto-assigned to target students |
| `GET` | `/financial/additional-fees` | 🛡️ | List all additional fees |
| `GET` | `/financial/additional-fees/:id` | 🛡️ | Get by ID |
| `DELETE` | `/financial/additional-fees/:id` | 🛡️ | Delete fee and remove from all student records |
| `POST` | `/financial/additional-fees/:feeId/pay/:studentId` | 🛡️ | Record payment for an additional fee |

---

### 5.19 Financial — Bus Module

Base path: `/financial/bus`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/financial/bus` | 🛡️ | List students enrolled in bus service |
| `GET` | `/financial/bus/candidates` | 🛡️ | List students not enrolled (new enrollment candidates) |
| `GET` | `/financial/bus/me` | 🔐 | Student's own bus plan details |
| `GET` | `/financial/bus/:studentId` | 🛡️ | Bus profile for a specific student |
| `POST` | `/financial/bus/:studentId/enroll` | 🛡️ | Enroll student in bus service |
| `POST` | `/financial/bus/:studentId/pay` | 🛡️ | Record a bus payment |
| `DELETE` | `/financial/bus/:studentId/unenroll` | 🛡️ | Unenroll student from bus service |

#### `POST /financial/bus/:studentId/enroll`

```json
{
  "serviceType": "both",
  "fee": 3000,
  "installmentPlanId": "6650a1b2c3d4e5f6a7b8c9d0"
}
```

**`serviceType` values:** `"pickup"` | `"dropoff"` | `"both"`

**List endpoints filter parameters:** `academicYear`, `classId`, `page`, `limit`

---

### 5.20 Financial — Trips Module

Base path: `/financial/trips`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/financial/trips` | 🛡️ | Create a trip template |
| `GET` | `/financial/trips` | 🛡️ | List trip templates |
| `GET` | `/financial/trips/:tripTemplateId` | 🛡️ | Get trip template details |
| `GET` | `/financial/trips/:tripTemplateId/students` | 🛡️ | List students enrolled in a trip |
| `GET` | `/financial/trips/:tripTemplateId/candidates` | 🛡️ | List students who can be added |
| `POST` | `/financial/trips/:tripTemplateId/enroll` | 🛡️ | Add a student to a trip |
| `DELETE` | `/financial/trips/:tripTemplateId/students/:studentId` | 🛡️ | Remove a student from a trip |

---

### 5.21 Expenses — Categories

Base path: `/expenses/categories`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/expenses/categories` | 🛡️ | Create an expense category |
| `GET` | `/expenses/categories` | 🛡️ | List all categories |
| `GET` | `/expenses/categories/:id` | 🛡️ | Get category by ID |
| `PATCH` | `/expenses/categories/:id` | 🛡️ | Update a category |
| `DELETE` | `/expenses/categories/:id` | 🛡️ | Delete category (blocked if has expenses) |

#### `POST /expenses/categories`

```json
{ "name": "Utilities", "description": "Electricity, water, internet" }
```

---

### 5.22 Expenses

Base path: `/expenses`  
**All endpoints require `JwtAuthGuard` + `AbilitiesGuard`.**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/expenses` | 🛡️ | Create an expense |
| `GET` | `/expenses` | 🛡️ | List expenses (paginated + filterable) |
| `GET` | `/expenses/:id` | 🛡️ | Get expense by ID |
| `PATCH` | `/expenses/:id` | 🛡️ | Update an expense |
| `DELETE` | `/expenses/:id` | 🛡️ | Delete an expense |

#### `POST /expenses`

```json
{
  "name": "Electricity Bill - September",
  "amount": 1500,
  "categoryId": "6650a1b2c3d4e5f6a7b8c9d0",
  "academicYear": "2024-2025",
  "date": "2026-07-01"
}
```

#### `GET /expenses` — Filter Parameters

| Param | Type |
|---|---|
| `name` | String |
| `categoryId` | ObjectId |
| `academicYear` | String |
| `dateFrom` | Date |
| `dateTo` | Date |

---

## 6. Standard Response Envelope

All responses are wrapped by the global `ResponseInterceptor`.

**Success:**

```json
{
  "success": true,
  "statusCode": 200,
  "data": { }
}
```

**Paginated Success:**

```json
{
  "success": true,
  "statusCode": 200,
  "data": [ ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 10,
    "totalPages": 15
  }
}
```

**Error:**

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Student not found"
}
```

**Common HTTP Status Codes:**

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `400` | Bad Request / Validation Error |
| `401` | Unauthorized — missing or invalid JWT |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found |
| `409` | Conflict — duplicate resource |
| `500` | Internal Server Error |

---

## 7. Environment Variables

| Variable | Required | Example | Description |
|---|---|---|---|
| `MONGODB_URI` | ✅ | `mongodb://localhost:27017/aura-school-system` | MongoDB connection string |
| `PORT` | ❌ | `3000` | Server port (default: `3000`) |
| `JWT_SECRET` | ✅ | `your_super_secret_key_here` | Secret for signing JWT tokens |
| `JWT_EXPIRE_IN` | ❌ | `1d` | JWT expiration duration (default: `1d`) |

### Example `.env`

```dotenv
# Database
MONGODB_URI=mongodb://localhost:27017/aura-school-system

# Server
PORT=3000

# Authentication
JWT_SECRET=your_super_secret_key_here_min_32_chars
JWT_EXPIRE_IN=1d
```

> ⚠️ **Security Warning:** Never commit real secrets to version control. `JWT_SECRET` should be at least 32 random characters.

### Running with Docker

```bash
docker compose up -d
```

This starts the application and a MongoDB instance using the environment variables in `docker-compose.yaml`.

---

*Documentation generated from `src/` source code scan — Aura School System v1.0*
