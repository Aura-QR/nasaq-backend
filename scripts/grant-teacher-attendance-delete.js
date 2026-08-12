/**
 * One-off: grant TEACHER `attendance.delete` on permission documents that were
 * already seeded before the default changed.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * getDefaultPermissions() in permissions.service.ts only runs the first time a
 * role is seeded for a school. Every school that has already logged a teacher in
 * has a stored Permission document with attendance.delete = false, and changing
 * the default does nothing for them.
 *
 * WHY THE PERMISSION IS NEEDED
 * ----------------------------
 * Attendance is absence-based: a record exists ⇒ that student was absent.
 * Deleting the record is therefore the UNDO for a mistaken absence. A teacher
 * who can record but not delete cannot correct their own mistake.
 *
 * This is safe because AttendanceService.assertMayTouchRecord() scopes a
 * teacher's edit and delete to classes they actually teach on that record's
 * own date — the same rule that already governs recording.
 *
 * RUN
 *   mongosh "<MONGODB_URI>" scripts/grant-teacher-attendance-delete.js
 *
 * Idempotent: re-running changes nothing once applied.
 */

const before = db.permissions.countDocuments({
  role: 'TEACHER',
  'permissions.attendance.delete': false,
});

print(`TEACHER permission docs with attendance.delete = false: ${before}`);

if (before === 0) {
  print('Nothing to do.');
} else {
  const res = db.permissions.updateMany(
    { role: 'TEACHER', 'permissions.attendance.delete': false },
    { $set: { 'permissions.attendance.delete': true } },
  );
  print(`Matched ${res.matchedCount}, modified ${res.modifiedCount}.`);
}

// Teachers must re-login for this to take effect: permissions are baked into
// the JWT at login and are not re-read per request.
print('Reminder: affected teachers need to log in again to pick up the change.');
