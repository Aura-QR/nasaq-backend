export enum Role {
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  SUPERVISOR = 'SUPERVISOR',
  // Service staff — a guard, a cleaner, a driver. Signs in only to record
  // their own attendance; holds no school permission at all.
  STAFF = 'STAFF',
  SUPER_ADMIN = 'SUPER_ADMIN',
}