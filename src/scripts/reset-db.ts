import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('❌ Error: MONGODB_URI is not set in environment variables.');
  process.exit(1);
}

// Credentials Configuration
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'qraura0@gmail.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Aura#2026';
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Super Admin';

const DEFAULT_PASSWORD = process.env.DEFAULT_TEST_PASSWORD || 'Password123!';

async function resetAndSeed() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    if (!db) {
      throw new Error('Failed to connect to MongoDB database instance.');
    }

    console.log('⚠️ Dropping all existing database collections and data...');
    await db.dropDatabase();
    console.log('✅ Database dropped successfully.');

    const defaultHashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const superAdminHashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
    const now = new Date();

    // 1. Seed Platform Super Admin
    console.log(`🌱 1/9 Seeding Super Admin (${SUPER_ADMIN_EMAIL})...`);
    await db.collection('platformadmins').insertOne({
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL.toLowerCase().trim(),
      password: superAdminHashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Seed Demo School
    console.log('🌱 2/9 Seeding Demo School (nasaq-demo)...');
    const schoolId = new mongoose.Types.ObjectId();
    const ownerId = new mongoose.Types.ObjectId();
    const academicYearId = new mongoose.Types.ObjectId();

    await db.collection('schools').insertOne({
      _id: schoolId,
      name: 'مدرسة النسق النموذجية',
      slug: 'nasaq-demo',
      email: 'school@nasaq.com',
      phone: '0112345678',
      country: 'Saudi Arabia',
      city: 'الرياض',
      address: 'طريق الملك فهد، الرياض',
      subscriptionPlan: 'pro',
      subscriptionStatus: 'active',
      isActive: true,
      ownerId: ownerId,
      settings: {
        activeAcademicYearId: academicYearId,
        timezone: 'Asia/Riyadh',
        language: 'ar',
        termsPerYear: 3,
      },
      createdAt: now,
      updatedAt: now,
    });

    // 3. Seed Admins (Owner, Manager, Supervisor)
    console.log('🌱 3/9 Seeding School Admins (Owner, Manager, Supervisor)...');
    const managerId = new mongoose.Types.ObjectId();
    const supervisorId = new mongoose.Types.ObjectId();

    await db.collection('admins').insertMany([
      {
        _id: ownerId,
        schoolId: schoolId,
        username: 'owner',
        email: 'owner@nasaq.com',
        password: defaultHashedPassword,
        role: 'OWNER',
        permissions: ['*'],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: managerId,
        schoolId: schoolId,
        username: 'manager',
        email: 'manager@nasaq.com',
        password: defaultHashedPassword,
        role: 'MANAGER',
        permissions: [
          'students.read', 'students.add', 'students.edit',
          'teachers.read', 'teachers.add', 'teachers.edit',
          'classes.read', 'classes.add', 'classes.edit',
          'subjects.read', 'subjects.add', 'exams.read', 'attendance.read'
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: supervisorId,
        schoolId: schoolId,
        username: 'supervisor',
        email: 'supervisor@nasaq.com',
        password: defaultHashedPassword,
        role: 'SUPERVISOR',
        permissions: ['*'],
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 4. Seed Academic Year & Terms
    console.log('🌱 4/9 Seeding Academic Year & Terms...');
    await db.collection('academicyears').insertOne({
      _id: academicYearId,
      schoolId: schoolId,
      name: '2025-2026',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-06-30'),
      status: 'active',
      setupStep: 7,
      createdAt: now,
      updatedAt: now,
    });

    const term1Id = new mongoose.Types.ObjectId();
    const term2Id = new mongoose.Types.ObjectId();

    await db.collection('terms').insertMany([
      {
        _id: term1Id,
        schoolId: schoolId,
        academicYearId: academicYearId,
        name: 'الفصل الدراسي الأول',
        order: 1,
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-12-31'),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: term2Id,
        schoolId: schoolId,
        academicYearId: academicYearId,
        name: 'الفصل الدراسي الثاني',
        order: 2,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        status: 'upcoming',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 5. Seed Stage, Grade Level, Class & Subjects
    console.log('🌱 5/9 Seeding Stage, Grade Level, Class, and Subjects...');
    const stageId = new mongoose.Types.ObjectId();
    await db.collection('stages').insertOne({
      _id: stageId,
      schoolId: schoolId,
      name: 'المرحلة الابتدائية',
      order: 1,
      createdAt: now,
      updatedAt: now,
    });

    const gradeLevelId = new mongoose.Types.ObjectId();
    await db.collection('gradelevels').insertOne({
      _id: gradeLevelId,
      schoolId: schoolId,
      stageId: stageId,
      name: 'الصف الأول الابتدائي',
      order: 1,
      createdAt: now,
      updatedAt: now,
    });

    const teacherId = new mongoose.Types.ObjectId();
    const classId = new mongoose.Types.ObjectId();

    await db.collection('classes').insertOne({
      _id: classId,
      schoolId: schoolId,
      gradeLevelId: gradeLevelId,
      academicYearId: academicYearId,
      name: 'فصل 1-أ',
      gender: 'male',
      roomNumber: '101',
      maxCapacity: 30,
      teacherInChargeId: teacherId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const mathSubjectId = new mongoose.Types.ObjectId();
    const arabicSubjectId = new mongoose.Types.ObjectId();

    await db.collection('subjects').insertMany([
      {
        _id: mathSubjectId,
        schoolId: schoolId,
        subjectName: 'الرياضيات',
        subjectCode: 'MATH101',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: arabicSubjectId,
        schoolId: schoolId,
        subjectName: 'اللغة العربية',
        subjectCode: 'ARAB101',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const mathOfferingId = new mongoose.Types.ObjectId();
    await db.collection('subjectofferings').insertOne({
      _id: mathOfferingId,
      schoolId: schoolId,
      subjectId: mathSubjectId,
      gradeLevelId: gradeLevelId,
      termId: term1Id,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('gradesCriteria').insertOne({
      schoolId: schoolId,
      subjectOfferingId: mathOfferingId,
      final: 40,
      assignments: 20,
      assignmentsCount: 4,
      activities: 10,
      projects: 15,
      projectsCount: 1,
      quizzes: 15,
      quizzesCount: 3,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Seed Teacher & Teacher Assignment
    console.log('🌱 6/9 Seeding Teacher & Teacher Assignment...');
    await db.collection('teachers').insertOne({
      _id: teacherId,
      schoolId: schoolId,
      name: 'أحمد علي',
      email: 'teacher@nasaq.com',
      password: defaultHashedPassword,
      phoneNumber: '0501234567',
      qualification: 'بكالوريوس رياضيات',
      experience: '5 سنوات',
      specialization: 'رياضيات',
      hireDate: new Date('2024-01-01'),
      isActive: true,
      isInCharge: true,
      role: 'TEACHER',
      isManager: false,
      managerPermissions: [],
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('teacherassignments').insertOne({
      schoolId: schoolId,
      teacherId: teacherId,
      subjectOfferingId: mathOfferingId,
      createdAt: now,
      updatedAt: now,
    });

    // 7. Seed Student & Enrollment
    console.log('🌱 7/9 Seeding Student & Enrollment...');
    const studentId = new mongoose.Types.ObjectId();
    await db.collection('students').insertOne({
      _id: studentId,
      schoolId: schoolId,
      firstName: 'علي',
      fatherName: 'محمد',
      familyName: 'الغامدي',
      name: 'علي محمد الغامدي',
      birthDate: new Date('2017-05-15'),
      gender: 'male',
      nationality: 'سعودي',
      phoneNumber: '0507654321',
      email: 'student@nasaq.com',
      schoolEmail: 'student@nasaq.com',
      address: 'الرياض - حي النزهة',
      registrationDate: now,
      isActive: true,
      classId: classId,
      role: 'STUDENT',
      password: defaultHashedPassword,
      hasPassword: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('enrollments').insertOne({
      schoolId: schoolId,
      studentId: studentId,
      classId: classId,
      academicYearId: academicYearId,
      status: 'active',
      enrolledAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 8. Seed Role Permission Templates
    console.log('🌱 8/9 Seeding Role Permission Templates...');
    await db.collection('permissions').insertMany([
      {
        role: 'TEACHER',
        schoolId: schoolId,
        userId: null,
        permissions: {
          students: { read: true, add: false, edit: false, delete: false },
          teachers: { read: false, add: false, edit: false, delete: false },
          classes: { read: true, add: false, edit: false, delete: false },
          subjects: { read: false, add: false, edit: false, delete: false },
          lectures: { read: true, add: true, edit: true, delete: true },
          library: { read: true, add: true, edit: true, delete: false },
          attendance: { read: true, add: true, edit: true, delete: false },
          gradesCriteria: { read: true, add: false, edit: false, delete: false },
          exams: { read: true, add: true, edit: true, delete: true },
          projects: { read: true, add: true, edit: true, delete: true },
          grades: { read: true, add: true, edit: true, delete: false },
          preparation: { read: true, add: true, edit: true, delete: true },
          financial: { read: false, add: false, edit: false, delete: false },
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        role: 'STUDENT',
        schoolId: schoolId,
        userId: null,
        permissions: {
          students: { read: false, add: false, edit: false, delete: false },
          teachers: { read: false, add: false, edit: false, delete: false },
          classes: { read: false, add: false, edit: false, delete: false },
          subjects: { read: false, add: false, edit: false, delete: false },
          lectures: { read: true, add: false, edit: false, delete: false },
          library: { read: true, add: false, edit: false, delete: false },
          attendance: { read: true, add: false, edit: false, delete: false },
          gradesCriteria: { read: false, add: false, edit: false, delete: false },
          exams: { read: true, add: false, edit: false, delete: false },
          projects: { read: true, add: false, edit: false, delete: false },
          grades: { read: true, add: false, edit: false, delete: false },
          preparation: { read: false, add: false, edit: false, delete: false },
          financial: { read: false, add: false, edit: false, delete: false },
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        role: 'MANAGER',
        schoolId: schoolId,
        userId: null,
        permissions: {
          students: { read: true, add: true, edit: true, delete: false },
          teachers: { read: true, add: true, edit: true, delete: false },
          classes: { read: true, add: true, edit: true, delete: false },
          subjects: { read: true, add: true, edit: true, delete: false },
          lectures: { read: true, add: true, edit: true, delete: true },
          library: { read: true, add: true, edit: true, delete: true },
          attendance: { read: true, add: true, edit: true, delete: true },
          gradesCriteria: { read: true, add: true, edit: true, delete: true },
          exams: { read: true, add: true, edit: true, delete: true },
          projects: { read: true, add: true, edit: true, delete: true },
          grades: { read: true, add: true, edit: true, delete: true },
          preparation: { read: true, add: true, edit: true, delete: true },
          financial: { read: true, add: false, edit: false, delete: false },
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        role: 'SUPERVISOR',
        schoolId: schoolId,
        userId: null,
        permissions: {
          students: { read: true, add: true, edit: true, delete: true },
          teachers: { read: true, add: true, edit: true, delete: true },
          classes: { read: true, add: true, edit: true, delete: true },
          subjects: { read: true, add: true, edit: true, delete: true },
          lectures: { read: true, add: true, edit: true, delete: true },
          library: { read: true, add: true, edit: true, delete: true },
          attendance: { read: true, add: true, edit: true, delete: true },
          gradesCriteria: { read: true, add: true, edit: true, delete: true },
          exams: { read: true, add: true, edit: true, delete: true },
          projects: { read: true, add: true, edit: true, delete: true },
          grades: { read: true, add: true, edit: true, delete: true },
          preparation: { read: true, add: true, edit: true, delete: true },
          financial: { read: true, add: true, edit: true, delete: true },
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 9. Seed Counters
    console.log('🌱 9/9 Initializing Counters...');
    await db.collection('counters').insertOne({
      name: 'students_counter',
      count: 1,
      year: '2025',
    });

    console.log('✅ All data seeded successfully!');
    console.log('====================================================');
    console.log('🎉 Reset and seeding complete!');
    console.log('====================================================');
    console.log(`🏫 Demo School Slug: nasaq-demo`);
    console.log('----------------------------------------------------');
    console.log(`🔑 1. SUPER_ADMIN`);
    console.log(`   Email:    ${SUPER_ADMIN_EMAIL}`);
    console.log(`   Password: ${SUPER_ADMIN_PASSWORD}`);
    console.log('----------------------------------------------------');
    console.log(`🔑 2. OWNER`);
    console.log(`   Email / Username: owner@nasaq.com / owner`);
    console.log(`   Password:         ${DEFAULT_PASSWORD}`);
    console.log(`   School Slug:      nasaq-demo`);
    console.log('----------------------------------------------------');
    console.log(`🔑 3. MANAGER`);
    console.log(`   Email / Username: manager@nasaq.com / manager`);
    console.log(`   Password:         ${DEFAULT_PASSWORD}`);
    console.log(`   School Slug:      nasaq-demo`);
    console.log('----------------------------------------------------');
    console.log(`🔑 4. SUPERVISOR`);
    console.log(`   Email / Username: supervisor@nasaq.com / supervisor`);
    console.log(`   Password:         ${DEFAULT_PASSWORD}`);
    console.log(`   School Slug:      nasaq-demo`);
    console.log('----------------------------------------------------');
    console.log(`🔑 5. TEACHER`);
    console.log(`   Email:            teacher@nasaq.com`);
    console.log(`   Password:         ${DEFAULT_PASSWORD}`);
    console.log(`   School Slug:      nasaq-demo`);
    console.log('----------------------------------------------------');
    console.log(`🔑 6. STUDENT`);
    console.log(`   Email:            student@nasaq.com`);
    console.log(`   Password:         ${DEFAULT_PASSWORD}`);
    console.log(`   School Slug:      nasaq-demo`);
    console.log('====================================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  }
}

resetAndSeed();
