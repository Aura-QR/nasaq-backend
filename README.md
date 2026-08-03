# 🎓 Nasaq School System - Backend

A comprehensive multi-tenant school management SaaS backend built with NestJS and MongoDB. This API provides robust modules for managing multi-tenancy, academic years, terms, stages, grade levels, classes, enrollments, subject offerings, teacher assignments, schedules, students, teachers, exams, projects, attendance, financial ledgers, and administrative operations.

---

## 🚀 Key Features

- **Multi-Tenancy SaaS Core** — Tenant-scoped data isolation via custom Mongoose plugin & request context (`AsyncLocalStorage`).
- **First-Time School Onboarding** — Step-by-step setup workflow for brand new school tenants.
- **Start New Year Wizard (7 Steps)** — Annual academic year rollover engine supporting:
  - Year creation & auto-archiving (`AcademicYear`)
  - Terms setup & copying (`Term`)
  - Class structure copying (`Class`)
  - Bulk student promotion engine (`Enrollment`)
  - Subject offerings & teacher assignments copying (`SubjectOffering`, `TeacherAssignment`)
  - Copy schedule engine with conflict detection & unassigned lecture fallback (`Lecture`)
- **Student & Enrollment Management** — Year-scoped student placement and promotion tracking.
- **Teacher & Assignment Management** — Teacher profiles and year-scoped subject offering assignments.
- **Timetable & Copy Schedule Engine** — Class and teacher slot conflict prevention and automated schedule migration across terms/years.
- **Exams, Criteria & Projects** — Online exams with automated question grading, flexible evaluation criteria, and file-based student projects.
- **Financial & Expense Management** — Tuition, bus, trip subscriptions, installment plans, discounts, additional fees, and expense tracking.
- **API Documentation** — Complete interactive Swagger UI at `/api/docs`.

---

## 🛠️ Tech Stack

- **Framework:** NestJS
- **Database:** MongoDB & Mongoose
- **Language:** TypeScript
- **Authorization:** CASL (`@CheckAbilities`)
- **API Documentation:** Swagger / OpenAPI
- **Validation:** class-validator & class-transformer

---

## 📋 Prerequisites

Ensure you have the following installed:
- Node.js (v18 or higher)
- npm or yarn
- MongoDB instance (v6 or higher)

---

## ⚙️ Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nasaq-backend
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Configure your `MONGO_URI` and `JWT_SECRET` in `.env`.

3. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```

---

## 🏃 Running the Application

Start the development server:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

---

## 🗄️ Database Reset & Multi-Role Seeding

To completely clear all data in the MongoDB database and seed a fresh development/testing environment with all 6 user roles and linked academic data, run:

```bash
npm run db:reset
```

### Seeded Credentials Summary

| Role | Identifier / Email | Password | School Slug |
| :--- | :--- | :--- | :--- |
| **SUPER_ADMIN** | `qraura0@gmail.com` | `Aura#2026` | N/A (Platform Admin) |
| **OWNER** | `owner@nasaq.com` or `owner` | `Password123!` | `nasaq-demo` |
| **MANAGER** | `manager@nasaq.com` or `manager` | `Password123!` | `nasaq-demo` |
| **SUPERVISOR** | `supervisor@nasaq.com` or `supervisor` | `Password123!` | `nasaq-demo` |
| **TEACHER** | `teacher@nasaq.com` | `Password123!` | `nasaq-demo` |
| **STUDENT** | `student@nasaq.com` | `Password123!` | `nasaq-demo` |

### Seeded Relational Data

- **School:** `مدرسة النسق النموذجية` (slug: `nasaq-demo`)
- **Academic Year:** `2025-2026` (Active)
- **Terms:** `الفصل الدراسي الأول` (Active), `الفصل الدراسي الثاني` (Upcoming)
- **Stage & Grade:** `المرحلة الابتدائية` -> `الصف الأول الابتدائي` -> `فصل 1-أ`
- **Subjects:** `الرياضيات` (MATH101), `اللغة العربية` (ARAB101)
- **Offerings & Assignments:** Math offered in Grade 1, assigned to Teacher `أحمد علي`
- **Enrollment:** Student `علي محمد الغامدي` enrolled in `فصل 1-أ`
- **Permissions:** Pre-configured permission templates for `TEACHER`, `STUDENT`, `MANAGER`, and `SUPERVISOR`.

---

## 📚 API Documentation

Access the interactive API documentation at:
- **Swagger UI:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- **Architecture Docs:** `docs/MULTI_TENANT_ARCHITECTURE.md`
- **API Reference:** `docs/API_DOCUMENTATION.md`
- **Operational Workflow:** `docs/OPERATIONAL_WORKFLOW.md`

---

## 📁 Project Modules Structure

```
src/
├── academic-years/       # Academic years & wizard setup tracker
├── terms/                # Term management & copy engine
├── stages/               # Tenant-scoped stages
├── grade-levels/         # Tenant-scoped grade levels & progression
├── classes/              # Classroom management & class copy engine
├── enrollments/          # Student year-scoped enrollments & bulk promotion
├── subject-offerings/    # Year-scoped subject offerings & copy engine
├── teacher-assignments/  # Teacher subject offering assignments
├── subjects/             # Master subject catalog
├── teachers/             # Teacher profiles & directory
├── students/             # Student records & portal accounts
├── attendance/           # Daily absence tracking
├── lectures/             # Lecture schedule & copy schedule engine
├── exams/                # Exams, questions & result grading
├── grades-criteria/     # Evaluation weighting criteria
├── projects/             # Student project submissions & evaluation
├── preparation/          # Teacher lesson preparation uploads
├── library/              # Digital library resource links
├── financial/            # Tuition, bus, trips, discounts, installments
├── expenses/             # School expense tracking
├── tenancy/              # Multi-tenant scoping plugin & request context
├── platform/             # Super Admin platform & school registration
└── auth/                 # Authentication & authorization guards
```