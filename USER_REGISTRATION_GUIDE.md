# Aura School System — User Registration & Role Provisioning Guide

> **Version:** 2.1 (Multi-Tenant SaaS)  
> **Last Updated:** 2026-07-27  
> **System Architecture:** NestJS + Mongoose

---

## ⚡ 1. How to Add a `SUPERVISOR` (Vice Principal)

> **Note**: A `SUPERVISOR` has implicit wildcard permissions `["*"]` across all school operations. For security, a Supervisor account can **only** be created by the primary **School `OWNER`**.

### Registration Details
* **Method**: `POST`
* **Endpoint**: `{{baseUrl}}/managers`
* **Auth**: 🔒 Protected (Requires **`OWNER`** JWT Bearer Token)
* **Headers**: `Content-Type: application/json`

### Request Body Payload
```json
{
  "username": "supervisor_hassan",
  "email": "supervisor.hassan@school.com",
  "password": "Supervisor#2026",
  "role": "SUPERVISOR",
  "permissions": ["*"]
}
```

### Response Example (`201 Created`)
```json
{
  "message": "تم إضافة المشرف بنجاح",
  "admin": {
    "id": "6650a1b2c3d4e5f6a7b8c9d0",
    "username": "supervisor_hassan",
    "email": "supervisor.hassan@school.com",
    "role": "SUPERVISOR"
  }
}
```

---

## 🏛️ 2. Role Provisioning Overview Table

| Role | Target Level | Who Can Create Them? | Registration Endpoint | Auth Requirement |
| :--- | :--- | :--- | :--- | :--- |
| 🛡️ **`SUPER_ADMIN`** | Platform | System Admin / CLI | `npm run seed:super-admin` | ⚙️ CLI / DB Seed |
| 👑 **`OWNER`** | School | Tenant Registration | `POST /schools/register` | 🌐 Public |
| ⚡ **`SUPERVISOR`** | School | School Owner | `POST /managers` | 🔒 Owner JWT |
| 👔 **`MANAGER`** | School | Owner or Supervisor | `POST /managers` | 🔒 Owner/Supervisor JWT |
| 👨‍🏫 **`TEACHER`** | School | Owner, Supervisor, or Manager | `POST /teachers` | 🔒 Admin JWT |
| 🎓 **`STUDENT`** | School | Owner, Supervisor, or Manager | `POST /students` | 🔒 Admin JWT |

---

## 📋 3. Step-by-Step Registration & Payloads by Role

---

### 🛡️ Role 1: `SUPER_ADMIN` (Platform Super Admin)

* **Scope**: Cross-Tenant SaaS Management (`schoolId: null`)
* **Creation Method**: CLI Command / Seed Script

#### Command:
```bash
npm run seed:super-admin
```

#### What it does:
Connects to MongoDB and seeds/updates the platform super admin account (`qraura0@gmail.com` / `Aura#2026`) in the `platformadmins` collection.

---

### 👑 Role 2: `OWNER` (School Owner)

* **Scope**: Primary owner of a registered school tenant
* **Creation Method**: Self-registration during school onboarding

#### Request Details:
* **Method**: `POST`
* **Endpoint**: `/schools/register`
* **Auth**: 🌐 **Public**
* **Headers**: `Content-Type: application/json`

#### Request Payload:
```json
{
  "schoolName": "Aura International School",
  "slug": "aura-school",
  "schoolEmail": "info@auraschool.com",
  "phone": "+201234567890",
  "ownerName": "Ahmed Hassan",
  "ownerUsername": "owner_ahmed",
  "ownerEmail": "owner@auraschool.com",
  "ownerPassword": "Owner#2026"
}
```

---

### 👔 Role 3: `MANAGER` (Granular Admin)

* **Scope**: School admin with custom assigned permissions
* **Creation Method**: Created by `OWNER` or `SUPERVISOR` (or promoted from Teacher)

#### Option A: Direct Creation via `/managers`
* **Method**: `POST`
* **Endpoint**: `/managers`
* **Auth**: 🔒 **Owner** or **Supervisor** JWT
* **Payload**:
  ```json
  {
    "username": "manager_mona",
    "email": "manager.mona@school.com",
    "password": "Manager#2026",
    "role": "MANAGER",
    "permissions": [
      "school.students.read",
      "school.students.create",
      "school.classes.read",
      "school.financial.read"
    ]
  }
  ```

#### Option B: Promote Existing Teacher
* **Method**: `PATCH`
* **Endpoint**: `/managers/promote/:teacherId`
* **Auth**: 🔒 **Owner** or **Supervisor** JWT

---

### 👨‍🏫 Role 4: `TEACHER` (Academic Staff)

* **Scope**: Classroom & Subject instructor
* **Creation Method**: Created by `OWNER`, `SUPERVISOR`, or `MANAGER` (with `school.teachers.create` permission)

#### Request Details:
* **Method**: `POST`
* **Endpoint**: `/teachers`
* **Auth**: 🔒 Protected (Requires Admin JWT)
* **Payload**:
  ```json
  {
    "name": "Mahmoud Ali",
    "email": "mahmoud.teacher@school.com",
    "password": "Teacher#2026",
    "phoneNumber": "+201234567890",
    "subjectIds": ["6650a1b2c3d4e5f6a7b8c9d0"],
    "qualification": "Bachelor of Science",
    "experience": "5 years",
    "specialization": "Mathematics",
    "hireDate": "2026-01-01",
    "address": "Cairo, Egypt",
    "isActive": true
  }
  ```

---

### 🎓 Role 5: `STUDENT` (Learner Workflow)

Student onboarding is a **2-Step Process**:

#### Step 1: Account Creation by Admin
* **Method**: `POST`
* **Endpoint**: `/students`
* **Auth**: 🔒 Protected (Requires Admin JWT with `school.students.create`)
* **Payload**:
  ```json
  {
    "firstName": "Youssef",
    "familyName": "Hassan",
    "fatherName": "Ahmed",
    "birthDate": "2012-05-15",
    "gender": "male",
    "nationality": "Egyptian",
    "academicYear": "2024-2025",
    "phoneNumber": "+201234567890",
    "email": "youssef.parent@gmail.com",
    "address": "Giza, Egypt",
    "classId": "6650a1b2c3d4e5f6a7b8c9d1",
    "installmentPlanId": "6650a1b2c3d4e5f6a7b8c9d2",
    "isActive": true
  }
  ```
> *Note: The system automatically generates a unique student school email (e.g. `au260001@student.auraschool.com`).*

#### Step 2: Student First-Time Login / Password Setup (Self-Service)
1. **Request OTP**:
   * `POST /students/request-password-setup` (Public)
   * Payload: `{"email": "youssef.parent@gmail.com"}`
2. **Set Password with OTP**:
   * `POST /students/set-password` (Public)
   * Payload:
     ```json
     {
       "email": "youssef.parent@gmail.com",
       "otp": "123456",
       "password": "Student#2026"
     }
     ```

---

## 🔑 4. Unified Authentication Endpoint

Once any account is created, **ALL ROLES** authenticate through a single unified endpoint:

* **Method**: `POST`
* **Endpoint**: `/auth/login`
* **Auth**: 🌐 **Public**
* **Headers**: `Content-Type: application/json`

### Request Payload
```json
{
  "identifier": "username_or_email",
  "password": "your_password"
}
```

### Response Example
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "6650a1b2c3d4e5f6a7b8c9d0",
    "email": "user@school.com",
    "role": "SUPERVISOR",
    "schoolId": "6650a1b2c3d4e5f6a7b8c9d9"
  },
  "permissions": ["*"]
}
```
