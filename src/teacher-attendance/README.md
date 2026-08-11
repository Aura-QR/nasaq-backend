# Nasaq — Teacher Attendance Feature Documentation (Location Check-In & Manual Fallback)

---

## 1. Executive Summary & Core Philosophy

### The Goal: Verification, Not Just Convenience
School administration requires a verified, accountable attendance record for staff review, lateness tracking, and financial/payroll auditing.

### Presence vs Absence Model
- **Student Attendance**: Absence-based (A database record exists $\Rightarrow$ student was *absent*).
- **Teacher Attendance**: **Presence-based** (A database record exists $\Rightarrow$ teacher **was present** and carries their exact arrival time).
- **Consequence for Reporting**: Absence is dynamically computed. *"Who was absent today?"* is evaluated as **active teachers with no attendance record for the target date**, rather than looking up rows in an absence table.

### Dual-Layer Verification Engine
Neither GPS nor IP alone is absolute proof. Together, recorded transparently with an audit trail, they provide strong accountability:

| Verification Layer | Mechanism | Strength / Purpose |
|---|---|---|
| **GPS Geofence** | Haversine distance from school coordinates $\le$ `checkInRadiusMeters` | Stops casual check-ins from home; stores exact distance in meters. |
| **School Network IP** | Server checks request IP against `schoolNetworkIps` whitelist | Verified server-side from request connection header, un-fakeable off-site. |
| **Server-Side Timestamp** | `checkInAt` assigned via server clock `new Date()` | Prevents client clock manipulation. |
| **Compound Unique Index** | Mongo index `{ schoolId: 1, teacherId: 1, date: 1 }` | Guarantees exactly 1 check-in per day per teacher under high concurrency. |

#### Decision Rules for Self Check-in:
- **Pass (2/2)**: `gps: true, network: true` $\rightarrow$ **HTTP 200 OK** (Full Verification).
- **Pass (1/2)**: `gps: true, network: false` OR `gps: false, network: true` $\rightarrow$ **HTTP 200 OK** (Partial Verification — recorded & flagged for admin review).
- **Fail (0/2)**: `gps: false, network: false` $\rightarrow$ **HTTP 403 Forbidden** (Rejected with distance error message).

---

## 2. Database Schemas & Architecture

### 2.1 School Location & Attendance Settings
File: `src/platform/schools/schemas/school.schema.ts`

Added properties to `SchoolSettings`:
```typescript
@Prop({ type: { lat: Number, lng: Number }, default: null })
location: { lat: number; lng: number } | null;

@Prop({ default: 150, min: 20, max: 2000 })
checkInRadiusMeters: number;

@Prop({ type: [String], default: [] })
schoolNetworkIps: string[]; // Whitelisted public IP(s)

@Prop({ default: false })
teacherCheckInEnabled: boolean; // Feature toggle
```

> **Validation Rule**: `updateMySettings` in `SchoolsService` throws `HTTP 400 Bad Request` if attempting to set `teacherCheckInEnabled: true` when `location` is unconfigured.

### 2.2 Teacher Attendance Record Schema
File: `src/teacher-attendance/schemas/teacher-attendance.schema.ts`

```typescript
@Schema({ collection: 'teacherAttendance', timestamps: true })
export class TeacherAttendance extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Teacher', index: true })
  teacherId: mongoose.Types.ObjectId;

  @Prop({ type: Date, required: true })
  date: Date; // UTC Midnight (00:00:00.000Z)

  @Prop({ type: Date, required: true })
  checkInAt: Date; // Server timestamp

  @Prop({ required: true, enum: ['location', 'manual'], default: 'location' })
  method: string;

  @Prop({ type: { lat: Number, lng: Number }, default: null })
  coordinates: { lat: number; lng: number } | null;

  @Prop({ default: null })
  distanceMeters: number | null;

  @Prop({ type: { gps: Boolean, network: Boolean }, default: () => ({ gps: false, network: false }) })
  verification: { gps: boolean; network: boolean };

  @Prop({ default: false })
  mockLocationSuspected: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null, ref: 'Admin' })
  recordedBy: mongoose.Types.ObjectId | null; // null = self, ObjectId = admin

  @Prop()
  notes: string; // Notes / Reason for manual entry

  @Prop({ index: true })
  name: string; // Denormalized teacher name

  schoolId?: mongoose.Types.ObjectId; // Stamped automatically by tenantScopedPlugin
}

export const TeacherAttendanceSchema = SchemaFactory.createForClass(TeacherAttendance);
TeacherAttendanceSchema.plugin(tenantScopedPlugin);
TeacherAttendanceSchema.index({ schoolId: 1, date: 1 });
TeacherAttendanceSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });
```

---

## 3. Complete API Endpoint Reference

All endpoints are guarded by `JwtAuthGuard` and `RolesGuard`.

### 3.1 Teacher Self Check-in
`POST /teacher-attendance/check-in` 🔒 (`TEACHER` role)

#### Request Payload
```json
{
  "lat": 24.7136,
  "lng": 46.6753,
  "mockLocationSuspected": false
}
```

#### Responses
- **HTTP 200 OK (Success)**:
  ```json
  {
    "status": true,
    "message": "تم تسجيل حضورك",
    "data": {
      "checkInAt": "2026-09-20T07:52:11.000Z",
      "distanceMeters": 47,
      "verification": { "gps": true, "network": true }
    }
  }
  ```
- **HTTP 409 Conflict (Already Checked In Today)**:
  ```json
  {
    "status": true,
    "message": "تم تسجيل حضورك اليوم بالفعل",
    "data": {
      "checkInAt": "2026-09-20T07:52:11.000Z",
      "distanceMeters": 47,
      "verification": { "gps": true, "network": true }
    }
  }
  ```
- **HTTP 403 Forbidden (Both GPS & IP Failed)**:
  ```json
  {
    "statusCode": 403,
    "message": "الموقع الشبكي والإحداثيات خارج نطاق المدرسة (المسافة: 450 متر)",
    "error": "Forbidden"
  }
  ```
- **HTTP 400 Bad Request (Feature Disabled or Location Unconfigured)**:
  ```json
  {
    "statusCode": 400,
    "message": "التسجيل الذاتي غير مفعّل",
    "error": "Bad Request"
  }
  ```

---

### 3.2 Teacher Personal History
`GET /teacher-attendance/me` 🔒 (`TEACHER` role)

- **Query Parameters**: `dateFrom`, `dateTo`, `page`, `limit`.
- **Behavior**: Forces `teacherId = user.userId`. Never accepts a `teacherId` query override.

---

### 3.3 Auto-Detect Client IP (Admin Helper)
`GET /teacher-attendance/detect-ip` 🛡️ (`Admin` roles)

- **Response**: `{ "ip": "185.170.196.120" }`
- **Purpose**: Powers the 1-click IP detection button on the admin settings screen.

---

### 3.4 Admin Manual Check-in (Fallback)
`POST /teacher-attendance` 🛡️ (`Admin` roles: `OWNER`, `MANAGER`, `SUPERVISOR`, `SUPER_ADMIN`)

#### Request Payload
```json
{
  "teacherId": "60d5ecb8b5c9c22b8c8b4562",
  "date": "2026-09-20",
  "checkInAt": "07:45",
  "notes": "الجهاز لا يدعم تحديد الموقع"
}
```
- Sets `method: 'manual'`, `recordedBy: adminUserId`, `verification: { gps: false, network: false }`.

---

### 3.5 Absent Active Teachers Report
`GET /teacher-attendance/absent?date=2026-09-20` 🛡️ (`Admin` roles)

- **Response**:
  ```json
  {
    "date": "2026-09-20T00:00:00.000Z",
    "totalAbsent": 2,
    "absentTeachers": [
      {
        "_id": "60d5ecb8b5c9c22b8c8b4564",
        "name": "محمد علي",
        "email": "m.ali@school.com",
        "phoneNumber": "+966500000000"
      }
    ]
  }
  ```

---

### 3.6 Attendance Records Search & Corrections
- `GET /teacher-attendance`: Paginated filter (`teacherId`, `date`, `dateFrom`, `dateTo`, `method`, `page`, `limit`).
- `PATCH /teacher-attendance/:id`: Correct arrival time or notes. Automatically updates/maintains `recordedBy: adminUserId`.
- `DELETE /teacher-attendance/:id`: Remove attendance record.

---

## 4. Frontend Prototype Alignment Matrix

| UI Component (HTML Prototype) | Backend API & Feature | Alignment Status |
|---|---|---|
| **Settings Main Toggle** | `PATCH /schools/me/settings` $\rightarrow$ `teacherCheckInEnabled` | Enforces location requirement before enabling. |
| **School Location Radius Slider** | `checkInRadiusMeters` | Configures Geofence radius (20m – 2000m, default 150m). |
| **`📡 اكتشاف IP الجهاز الحالي`** | `GET /teacher-attendance/detect-ip` | Auto-detects client public IP via `x-forwarded-for` / socket. |
| **Phone Check-In Button** | `POST /teacher-attendance/check-in` | Executes dual verification and returns distance & status. |
| **Scenario 1 (Inside + Wi-Fi)** | `{ gps: true, network: true }` | Full Verification (HTTP 200 OK). |
| **Scenario 2 & 3 (Single Pass)** | `{ gps: true, network: false }` or `{ gps: false, network: true }` | Partial Verification (HTTP 200 OK — Flagged). |
| **Scenario 4 (Outside + Off-Net)** | `!gps && !network` | Rejects with HTTP 403 Forbidden. |
| **Absent Banner** | `GET /teacher-attendance/absent` | Computes active teachers without a record today. |
| **Admin Log Table** | `GET /teacher-attendance` | Displays `checkInAt`, `method`, `verification`, `distanceMeters`, `recordedBy`. |
| **Manual Modal** | `POST /teacher-attendance` | Saves entry as `method: 'manual'`, assigning `recordedBy: adminId`. |

---

## 5. Security & Anti-Cheat Controls

1. **Server Clock Ownership**: `checkInAt` is strictly populated via server `new Date()`. Any client timestamp is ignored.
2. **Compound Unique Index**: `TeacherAttendanceSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true })` prevents duplicate submissions under race conditions.
3. **Request IP Verification**: Network IP is read directly from request connection (`req.headers['x-forwarded-for']` or `req.ip`), never accepted from payload body.
4. **Mock Location Auditing**: Client flag `mockLocationSuspected` is stored for review without blocking legitimate users automatically.
5. **Strict Tenant Isolation**: `tenantScopedPlugin` automatically scopes all query operations and validates creation by active tenant `schoolId`.

---

## 6. Automated Testing Suite

Comprehensive unit & integration tests are located at `src/teacher-attendance/teacher-attendance.spec.ts`.

### Test Coverage Summary:
- **Haversine Distance**: Verifies 0m calculation and non-zero offsets.
- **Self Check-In**:
  - Rejection on disabled feature (`HTTP 400`).
  - Rejection on missing school location (`HTTP 400`).
  - Idempotent handling of existing check-ins (`HTTP 409`).
  - Full verification (`{ gps: true, network: true }`).
  - Single pass GPS verification (`{ gps: true, network: false }`).
  - Single pass Network verification (`{ gps: false, network: true }`).
  - Rejection when both checks fail (`HTTP 403`).
- **Manual Entry**: Verifies `method: 'manual'`, `recordedBy`, and missing teacher validation (`HTTP 404`).
- **Absent Report**: Verifies diff calculation between active teachers and present check-ins.

```
PASS src/teacher-attendance/teacher-attendance.spec.ts (12/12 passed)
Build Command: nest build (Exited with code 0)
```
