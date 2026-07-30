# Nasaq School System — Operational Workflow & Role Responsibilities

> **Document Purpose:** To clarify daily operational flows, system lifecycle (First-Time Onboarding & Start New Year Wizard), boundaries, and specific responsibilities of each user role within a School Tenant.

---

## System Lifecycle & Setup Wizards

The Nasaq platform distinguishes between two lifecycle phases for every school tenant:

### Phase 1: First-Time School Onboarding (From Scratch)
Used when onboarding a brand new school with no historical data on the platform.
1. **School Info (Tenant Setup):** School profile details (`POST /schools/register`).
2. **Stages & Grade Levels:** Establish school structure (Primary, Middle, High, etc.).
3. **Subject Bank:** Create master academic subject catalog.
4. **Teachers:** Add teacher accounts to the tenant directory.
5. **First Academic Year & Terms:** Create initial year & terms (manually set dates; dynamic terms per school via `SchoolSettings.termsPerYear`).
6. **Classes:** Create classrooms/sections per grade level.
7. **Student Registration:** Enroll initial students into classes.
8. **Subject Offerings & Teacher Assignments:** Map subjects to grade levels/terms and assign teachers.
9. **Timetable / Schedule:** Build weekly lecture schedule slot-by-slot.

### Phase 2: Start New Year Wizard (7 Steps with Data Reuse & Copy Engines)
Used annually when transitioning to a new academic year.
- **Step 1 — Create New Academic Year:** `POST /academic-years` creates the new year as `'active'` and automatically transitions the previous year to `'archived'` (no data deleted).
- **Step 2 — Copy Terms:** `POST /terms/copy-from/:targetYearId/:sourceYearId` copies term names and structure from a previous year.
- **Step 3 — Review Stages & Grade Levels:** Tenant-scoped structure is preserved automatically across years.
- **Step 4 — Copy Classes:** `POST /classes/copy-from/:targetYearId/:sourceYearId` clones class names and capacities under new year-scoped ObjectIds.
- **Step 5 — Bulk Student Promotion:** `GET /enrollments/promotion-preview/:currentYearId` previews next grade level progression and `POST /enrollments/bulk-promote` promotes/retains students into target classes in bulk.
- **Step 6 — Copy Subject Offerings:** `POST /subject-offerings/copy-from/:targetYearId/:sourceYearId` clones subject offerings and active teacher assignments.
- **Step 7 — Copy Timetable / Schedule Engine:** `POST /lectures/copy-from/:targetYearId/:targetTermId/:sourceTermId` executes intelligent schedule translation returning 4 buckets:
  1. `created`: Successfully matched & assigned lectures.
  2. `unresolved`: Source subject not offered in target term.
  3. `needsTeacher`: Subject offered, but no teacher assigned in target year.
  4. `teacherConflict`: Teacher assigned, but already booked at that slot (creates unassigned lecture for manual resolution).

---

## Roles Overview

Within a School Tenant, the available user roles are:
- **OWNER**: Primary school account holder. Full administrative, financial, and operational authority.
- **SUPERVISOR**: High-level school administrator. Full administrative, financial, and operational authority.
- **MANAGER**: Operational school manager. Full administrative and academic control, but strictly restricted from financial data and expense tracking.
- **TEACHER**: Academic executor. Access restricted strictly to assigned classes, lectures, students, exams, and projects.
- **STUDENT / PARENT**: Portal access. Read-only access to schedules, grades, attendance, digital library, and financial ledgers, plus interactive capabilities to take exams and submit projects.

---

## 1. 🏢 School Management (OWNER, SUPERVISOR, MANAGER)

*School management acts as the "Builders" and "Controllers" of the school.*

### A. Core Setup & Master Data
- **User Management:** Add and manage all students, teachers, staff, supervisors, and manager accounts.
- **Academic Structure:** Create Stages, Grade Levels, Classrooms (with capacity limits), Academic Subjects, and Grading Criteria (passing thresholds, grade evaluation rubrics).
- **Academic Years & Wizard Control:** Execute the 7-step "Start New Year" wizard, manage terms, bulk student promotions, and schedule copy engines.
- **Assignments:** Enroll students into year-scoped classes via `Enrollment`, assign subject offerings to grade levels, and assign teachers to subject offerings.
- **Hybrid Roles:** Option to promote specific Teachers to hold Manager privileges (`isManager`).

### B. Scheduling & Content Management
- **Timetable (Lectures):** Create, copy, and maintain weekly timetables linking teachers, subject offerings, classes, terms, days, and timeslots.
- **Digital Library:** Upload and manage general digital learning materials, textbooks, and school-wide reference files.

### C. Financial & Expense Management — OWNER & SUPERVISOR Only
- **Pricing & Fee Setup:** Define Tuition Fees (`FeeConfig`), Bus Subscriptions, Trip Fees, and Additional Fees (Uniforms, Books, etc.).
- **Discounts & Installments:** Apply student discounts (e.g., sibling/scholarship discounts) and configure installment plan schedules.
- **Revenue Collection:** Record payments received at school (cash, bank transfer) and track overdue balances and student financial ledgers.
- **Operational Expenses:** Log and categorize school operational expenditures (salaries, utilities, maintenance, supplies).
- **Executive Dashboard:** Access financial KPIs, revenue collection rates, and expense reports.
- **Security Boundary:** The `MANAGER` role is strictly restricted from financial and expense modules.

---

## 2. 👨‍🏫 The Teacher (TEACHER)

*The teacher acts as the "Academic Executor." They have zero administrative or financial control (unless explicitly assigned a dual Manager role).*

### A. Operational Restrictions
- Cannot add, edit, or delete students, teachers, or staff.
- Cannot create classes or subjects, or modify master tenant settings.
- Cannot view any financial data, tuition ledgers, or expense tracking.

### B. Daily Academic Operations
- **Personal Schedule:** View personal daily and weekly teaching timetables.
- **Lesson Preparation:** Upload lesson plans, objectives, and teaching files (`Preparation`) for assigned lectures.
- **Attendance Tracking:** Open active lectures and mark student attendance (Present, Absent, Late).
- **Library Contribution:** Access and share materials via the Digital Library.

### C. Evaluation & Grading
- **Exams:** Create class-specific online exams, configure question banks, set time limits, and grade student submissions.
- **Projects:** Assign class projects, download student submission attachments, and provide grades and feedback.

---

## 3. 🎓 The Student / Parent (STUDENT)

*The student account acts as a "Self-Service Portal." It is primarily read-only, with specific interactive elements for evaluations.*

### A. Tracking & Monitoring (Read-Only)
- **Academic Portal:** View weekly lecture schedules, enrolled subjects, and classmate lists.
- **Resource Center:** View lesson preparations uploaded by teachers and download books/files from the Digital Library.
- **Performance & Attendance:** Track attendance logs and published subject grades/evaluations.
- **Financial Ledger:** View tuition dues, upcoming installment deadlines, payment history, and bus/trip subscription statuses.

### B. Interactive Features
- **Exams:** Access active online exams, answer questions within designated time limits, and submit responses.
- **Projects:** Upload completed project files for teacher grading and view teacher feedback.

---

## Summary Responsibility Matrix

| Role | Academic & Timetable | Digital Library | Financials & Pricing | Operational Expenses | Management & Users |
|---|---|---|---|---|---|
| **OWNER / SUPERVISOR** | Full Control | Full Control | Full Access | Full Access | Full Control |
| **MANAGER** | Full Control | Full Control | ❌ Restricted | ❌ Restricted | Full Control |
| **TEACHER** | Assigned Classes Only | View & Share | ❌ Restricted | ❌ Restricted | ❌ Restricted |
| **STUDENT / PARENT** | Read-Only | Read & Download | Ledger Read-Only | ❌ Restricted | ❌ Restricted |
