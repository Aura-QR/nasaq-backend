import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Error: MONGODB_URI is not set in environment.');
  process.exit(1);
}

const collectionsToBackfill = [
  'admins',
  'students',
  'teachers',
  'classes',
  'subjects',
  'attendance',
  'lectures',
  'exams',
  'gradescriteria',
  'projects',
  'preparations',
  'library',
  'feeconfigs',
  'installmentplans',
  'studentfinancialrecords',
  'discounts',
  'additionalfees',
  'trips',
  'expenses',
  'expensecategories',
  'permissions',
];

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  console.log('Step 1: Creating Default School...');
  // Check if default school already exists
  let defaultSchool = await db.collection('schools').findOne({ slug: 'default-school' });
  if (!defaultSchool) {
    const res = await db.collection('schools').insertOne({
      name: 'Default School',
      slug: 'default-school',
      email: 'admin@defaultschool.com',
      subscriptionStatus: 'active',
      isActive: true,
      settings: {
        academicYear: '2026/2027',
        timezone: 'Asia/Riyadh',
        language: 'ar',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    defaultSchool = { _id: res.insertedId, name: 'Default School', slug: 'default-school' } as any;
    console.log(`Created Default School with ID: ${defaultSchool._id}`);
  } else {
    console.log(`Default School already exists with ID: ${defaultSchool._id}`);
  }

  const defaultSchoolId = defaultSchool._id;

  console.log('Step 2: Backfilling schoolId on collections...');
  for (const collName of collectionsToBackfill) {
    try {
      const count = await db.collection(collName).countDocuments({ schoolId: { $exists: false } });
      if (count > 0) {
        const updateRes = await db.collection(collName).updateMany(
          { schoolId: { $exists: false } },
          { $set: { schoolId: defaultSchoolId } }
        );
        console.log(`- Scoped ${updateRes.modifiedCount} docs in '${collName}' to default school`);
      } else {
        console.log(`- Collection '${collName}' is already backfilled or empty`);
      }
    } catch (e) {
      console.log(`- Skipping collection '${collName}' (not found or error: ${e.message})`);
    }
  }

  console.log('Step 3: Upgrading Admins to Owner/Manager...');
  const admins = await db.collection('admins').find({}).toArray();
  if (admins.length > 0) {
    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i];
      const role = i === 0 ? 'OWNER' : 'MANAGER';
      await db.collection('admins').updateOne(
        { _id: admin._id },
        { $set: { role, schoolId: defaultSchoolId } }
      );
      console.log(`- Converted admin '${admin.username}' to role: ${role}`);
      
      if (i === 0) {
        // Link owner to school
        await db.collection('schools').updateOne(
          { _id: defaultSchoolId },
          { $set: { ownerId: admin._id } }
        );
      }
    }
  } else {
    console.log('- No admins found to upgrade');
  }

  console.log('Step 4: Seeding Platform Admin...');
  const platformAdmin = await db.collection('platformadmins').findOne({ email: 'superadmin@nasaq.com' });
  if (!platformAdmin) {
    const hashedPassword = await bcrypt.hash('superadmin123', 10);
    await db.collection('platformadmins').insertOne({
      name: 'Super Admin',
      email: 'superadmin@nasaq.com',
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('- Created Super Admin: superadmin@nasaq.com / superadmin123');
  } else {
    console.log('- Super Admin already exists');
  }

  console.log('Step 5: Dropping old global unique indexes to prepare for compound unique indexes...');
  const dropIndexSilently = async (collection: string, index: string) => {
    try {
      await db.collection(collection).dropIndex(index);
      console.log(`- Dropped index '${index}' on collection '${collection}'`);
    } catch (e) {
      // Ignore if index doesn't exist
    }
  };

  await dropIndexSilently('students', 'email_1');
  await dropIndexSilently('students', 'schoolEmail_1');
  await dropIndexSilently('teachers', 'email_1');
  await dropIndexSilently('admins', 'username_1');
  await dropIndexSilently('admins', 'email_1');
  await dropIndexSilently('permissions', 'role_1');
  await dropIndexSilently('feeconfigs', 'academicYear_1');
  await dropIndexSilently('expensecategories', 'name_1');
  await dropIndexSilently('studentfinancialrecords', 'studentId_1_academicYear_1');

  console.log('Step 6: Seeding default permissions templates for default school...');
  const defaultTeacherPerms = {
    students: { read: true, add: false, edit: false, delete: false },
    teachers: { read: false, add: false, edit: false, delete: false },
    classes: { read: true, add: false, edit: false, delete: false },
    subjects: { read: false, add: false, edit: false, delete: false },
    lectures: { read: true, add: false, edit: false, delete: false },
    library: { read: true, add: false, edit: false, delete: false },
    attendance: { read: false, add: true, edit: true, delete: false },
    gradesCriteria: { read: true, add: false, edit: false, delete: false },
    exams: { read: true, add: true, edit: true, delete: true },
    projects: { read: true, add: true, edit: true, delete: true },
    grades: { read: true, add: true, edit: true, delete: false },
    preparation: { read: true, add: true, edit: true, delete: true },
    financial: { read: false, add: false, edit: false, delete: false },
  };

  const defaultStudentPerms = {
    students: { read: false, add: false, edit: false, delete: false },
    teachers: { read: false, add: false, edit: false, delete: false },
    classes: { read: false, add: false, edit: false, delete: false },
    subjects: { read: false, add: false, edit: false, delete: false },
    lectures: { read: false, add: false, edit: false, delete: false },
    library: { read: true, add: false, edit: false, delete: false },
    attendance: { read: true, add: false, edit: false, delete: false },
    gradesCriteria: { read: false, add: false, edit: false, delete: false },
    exams: { read: false, add: false, edit: false, delete: false },
    projects: { read: false, add: false, edit: false, delete: false },
    grades: { read: false, add: false, edit: false, delete: false },
    preparation: { read: false, add: false, edit: false, delete: false },
    financial: { read: false, add: false, edit: false, delete: false },
  };

  // Insert permissions templates for Default School
  await db.collection('permissions').updateOne(
    { role: 'TEACHER', schoolId: defaultSchoolId },
    { $set: { permissions: defaultTeacherPerms, userId: null } },
    { upsert: true }
  );
  await db.collection('permissions').updateOne(
    { role: 'STUDENT', schoolId: defaultSchoolId },
    { $set: { permissions: defaultStudentPerms, userId: null } },
    { upsert: true }
  );
  console.log('- Seeded TEACHER and STUDENT permissions templates for default school');

  console.log('Migration completed successfully!');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
