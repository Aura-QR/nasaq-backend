/**
 * One-off migration script: Backfill `financial` and `financialSettings` permissions
 * across all existing permission documents in MongoDB (especially for MANAGER role).
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Previous schools already have stored `permissions` documents in MongoDB.
 * Older documents do not have the newly-added `financial` and/or `financialSettings` keys,
 * which caused Manager accounts to be denied with "ليس لديك صلاحية" on financial pages.
 *
 * RUN
 *   mongosh "<MONGODB_URI>" scripts/backfill-financial-permissions.js
 *
 * Idempotent: re-running is completely safe.
 */

print('=================================================================');
print('Starting Financial & FinancialSettings Permissions Migration...');
print('=================================================================');

// 1. Backfill MANAGER
const managerQuery = {
  role: 'MANAGER',
  $or: [
    { 'permissions.financial': { $exists: false } },
    { 'permissions.financial': null },
    { 'permissions.financialSettings': { $exists: false } },
    { 'permissions.financialSettings': null },
  ],
};

const managerCount = db.permissions.countDocuments(managerQuery);
print(`\n[MANAGER] Documents needing financial/financialSettings update: ${managerCount}`);

if (managerCount > 0) {
  const res = db.permissions.updateMany(
    { role: 'MANAGER' },
    {
      $set: {
        'permissions.financial': { read: true, add: true, edit: true, delete: true },
        'permissions.financialSettings': { read: true, add: false, edit: false, delete: false },
      },
    }
  );
  print(`[MANAGER] Successfully updated ${res.modifiedCount} document(s).`);
} else {
  print('[MANAGER] All MANAGER documents already have financial permissions configured.');
}

// 2. Backfill SUPERVISOR
const supervisorQuery = {
  role: 'SUPERVISOR',
  $or: [
    { 'permissions.financial': { $exists: false } },
    { 'permissions.financial': null },
    { 'permissions.financialSettings': { $exists: false } },
    { 'permissions.financialSettings': null },
  ],
};

const supervisorCount = db.permissions.countDocuments(supervisorQuery);
print(`\n[SUPERVISOR] Documents needing update: ${supervisorCount}`);

if (supervisorCount > 0) {
  const res = db.permissions.updateMany(
    { role: 'SUPERVISOR' },
    {
      $set: {
        'permissions.financial': { read: true, add: true, edit: true, delete: true },
        'permissions.financialSettings': { read: true, add: true, edit: true, delete: true },
      },
    }
  );
  print(`[SUPERVISOR] Successfully updated ${res.modifiedCount} document(s).`);
}

// 3. Backfill TEACHER
const teacherQuery = {
  role: 'TEACHER',
  $or: [
    { 'permissions.financial': { $exists: false } },
    { 'permissions.financial': null },
    { 'permissions.financialSettings': { $exists: false } },
    { 'permissions.financialSettings': null },
  ],
};

const teacherCount = db.permissions.countDocuments(teacherQuery);
print(`\n[TEACHER] Documents needing update: ${teacherCount}`);

if (teacherCount > 0) {
  const res = db.permissions.updateMany(
    { role: 'TEACHER' },
    {
      $set: {
        'permissions.financial': { read: false, add: false, edit: false, delete: false },
        'permissions.financialSettings': { read: false, add: false, edit: false, delete: false },
      },
    }
  );
  print(`[TEACHER] Successfully updated ${res.modifiedCount} document(s).`);
}

// 4. Backfill STUDENT
const studentQuery = {
  role: 'STUDENT',
  $or: [
    { 'permissions.financial': { $exists: false } },
    { 'permissions.financial': null },
    { 'permissions.financialSettings': { $exists: false } },
    { 'permissions.financialSettings': null },
  ],
};

const studentCount = db.permissions.countDocuments(studentQuery);
print(`\n[STUDENT] Documents needing update: ${studentCount}`);

if (studentCount > 0) {
  const res = db.permissions.updateMany(
    { role: 'STUDENT' },
    {
      $set: {
        'permissions.financial': { read: false, add: false, edit: false, delete: false },
        'permissions.financialSettings': { read: false, add: false, edit: false, delete: false },
      },
    }
  );
  print(`[STUDENT] Successfully updated ${res.modifiedCount} document(s).`);
}

print('\n=================================================================');
print('Migration Complete.');
print('IMPORTANT: All users must log out and log in again for the updated');
print('permissions to be reflected in their JWT access tokens.');
print('=================================================================');
