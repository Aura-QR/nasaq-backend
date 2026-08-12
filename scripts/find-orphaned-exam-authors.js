/**
 * Report exams whose `createdBy` does not resolve to a Teacher.
 *
 * WHY THESE EXIST
 * ---------------
 * exam.schema.ts declares createdBy as ref: 'Teacher', but the service used to
 * store whoever was logged in. Any exam created by an OWNER/SUPERVISOR/MANAGER
 * therefore holds an Admin id in a Teacher reference. Mongoose does not verify
 * that the target exists, so it saved silently.
 *
 * WHAT BREAKS FOR THEM
 * --------------------
 *   1. Every populate('createdBy') returns null — the exam has no author on screen.
 *   2. GET /exams/teacher/me filters createdBy = <caller>, so the exam never
 *      appears for the teacher who actually gives it. From their side it does
 *      not exist.
 *   3. The edit guard compares createdBy to the caller, so the exam is editable
 *      by that one admin and by nobody else.
 *
 * Creation is now restricted to teachers, so no new orphans can appear. This
 * script only finds the ones already stored.
 *
 * RUN
 *   mongosh "<MONGODB_URI>" scripts/find-orphaned-exam-authors.js
 *
 * READ-ONLY. It reports and suggests; it does not modify anything, because
 * choosing the right teacher for an orphaned exam is a human decision.
 */

const orphans = db.exams
  .aggregate([
    {
      $lookup: {
        from: 'teachers',
        localField: 'createdBy',
        foreignField: '_id',
        as: 't',
      },
    },
    { $match: { t: { $size: 0 } } },
    {
      $project: {
        _id: 1,
        schoolId: 1,
        subjectOfferingId: 1,
        classIds: 1,
        examType: 1,
        createdBy: 1,
        createdAt: 1,
      },
    },
  ])
  .toArray();

print(`Exams with an unresolvable createdBy: ${orphans.length}`);

if (orphans.length === 0) {
  print('Nothing to fix.');
} else {
  orphans.forEach((e) => {
    printjson(e);
  });

  print('');
  print('To fix one, find the teacher who has a lecture for its subject offering:');
  print('');
  print('  db.lectures.find(');
  print('    { subjectOfferingId: <subjectOfferingId>, classId: { $in: <classIds> } },');
  print('    { teacherId: 1, classId: 1 }');
  print('  )');
  print('');
  print('then reassign:');
  print('');
  print('  db.exams.updateOne({ _id: <examId> }, { $set: { createdBy: <teacherId> } })');
  print('');
  print('If an exam has no matching lecture, nobody currently teaches it —');
  print('delete it rather than guessing an author.');
}
