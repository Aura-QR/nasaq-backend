import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { join } from 'path';
import { ResidencyDocumentsService } from './residency-documents.service';
import { StudentResidencyDocument, StudentResidencyDocumentSchema } from './residency-document.schema';
import { RESIDENCY_UPLOAD_DIR } from './multer-residency.config';
import { Student, StudentSchema } from '../schemas/student.schema';
import { Class, ClassSchema } from '../../classes/schemas/class.schema';
import { Admin, AdminSchema } from '../../admin/schemas/admin.schema';
import { StudentStatisticsService } from '../student-statistics.service';
import { GradeLevel, GradeLevelSchema } from '../../grade-levels/schemas/grade-level.schema';
import { Stage, StageSchema } from '../../stages/schemas/stage.schema';
import { AcademicYear, AcademicYearSchema } from '../../academic-years/schemas/academic-year.schema';
import { School, SchoolSchema } from '../../platform/schools/schemas/school.schema';
import { TenantContextService } from '../../tenancy/tenant-context.service';

dotenv.config();

describe('ResidencyDocumentsService', () => {
  const ctx = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();
  const run = <T>(fn: () => Promise<T>) => ctx.runWithTenant(schoolId, false, fn);
  const model = (name: string, schema: any) => mongoose.models[name] || mongoose.model(name, schema);
  const m: Record<string, any> = {};
  const notices: any[] = [];
  let service: ResidencyDocumentsService;
  let stats: StudentStatisticsService;
  const ids: Record<string, string> = {};
  const admin = { userId: new mongoose.Types.ObjectId().toString(), role: 'OWNER', schoolId };

  let n = 0;
  const upload = () => {
    if (!fs.existsSync(RESIDENCY_UPLOAD_DIR)) fs.mkdirSync(RESIDENCY_UPLOAD_DIR, { recursive: true });
    const filename = `test-${Date.now()}-${n++}.jpg`;
    fs.writeFileSync(join(RESIDENCY_UPLOAD_DIR, filename), 'x');
    return { filename, originalname: 'iqama.jpg', mimetype: 'image/jpeg', size: 1 };
  };
  const exists = (f: { filename: string }) => fs.existsSync(join(RESIDENCY_UPLOAD_DIR, f.filename));
  const student = (nationality: string, classId: any) =>
    m.student.create({
      firstName: 'ط', fatherName: 'م', familyName: `ع${n++}`, birthDate: new Date('2015-01-01'), gender: 'female',
      nationality, phoneNumber: `05${n}`, email: `r${n}-${schoolId}@t.test`, address: 'مكة', classId,
    });

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');
    m.doc = model(StudentResidencyDocument.name, StudentResidencyDocumentSchema);
    m.student = model(Student.name, StudentSchema);
    m.class = model(Class.name, ClassSchema);
    m.admin = model(Admin.name, AdminSchema);
    m.grade = model(GradeLevel.name, GradeLevelSchema);
    m.stage = model(Stage.name, StageSchema);
    m.year = model(AcademicYear.name, AcademicYearSchema);
    service = new ResidencyDocumentsService(m.doc, m.student, m.class, m.admin, { notify: async (x: any) => { notices.push(x); } } as any);
    stats = new StudentStatisticsService(m.student, m.class, m.grade, m.stage, m.year, model(School.name, SchoolSchema), ctx, m.doc);

    await run(async () => {
      const year = await m.year.create({ name: 'y', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-01'), status: 'active' });
      const stage = await m.stage.create({ name: 'ابتدائي', order: 1 });
      const grade = await m.grade.create({ name: 'الأول', order: 1, stageId: stage._id });
      const cls = await m.class.create({ name: 'أول أ', gradeLevelId: grade._id, academicYearId: year._id, gender: 'female', maxCapacity: 30 });
      ids.egypt = String((await student('مصر', cls._id))._id);
      ids.yemen = String((await student('اليمن', cls._id))._id);
      ids.syria = String((await student('سوريا', cls._id))._id);
      ids.saudi = String((await student('المملكة العربية السعودية', cls._id))._id);
    });
  });

  afterAll(async () => {
    await Promise.all(Object.values(m).map((x) => x.deleteMany({ schoolId })));
    for (const f of fs.existsSync(RESIDENCY_UPLOAD_DIR) ? fs.readdirSync(RESIDENCY_UPLOAD_DIR) : []) {
      if (f.startsWith('test-')) fs.unlinkSync(join(RESIDENCY_UPLOAD_DIR, f));
    }
    await mongoose.disconnect();
  });

  it("a student's upload waits for review, and a second one replaces it", async () => {
    const me = { userId: ids.egypt, role: 'STUDENT', schoolId };
    const first = upload();
    const a = await run(() => service.submitByStudent(me, { type: 'iqama', expiryDate: '2027-05-01' }, [first]));
    expect(a.status).toBe('pending');
    expect(a.files[0].url).toBe(`/residency-documents/${a._id}/files/0`);

    const second = upload();
    await run(() => service.submitByStudent(me, { type: 'iqama', documentNumber: '2345' }, [second]));
    const mine = await run(() => service.listForStudent(ids.egypt));
    expect(mine.documents).toHaveLength(1);
    expect(mine.documents[0].documentNumber).toBe('2345');
    expect(mine.current).toBeNull();
    expect(exists(first)).toBe(false);
  });

  it('refuses a Saudi student and removes the uploaded file', async () => {
    const f = upload();
    await expect(run(() => service.submitByAdmin(ids.saudi, admin, { type: 'passport' }, [f]))).rejects.toThrow('غير السعوديين');
    expect(exists(f)).toBe(false);
  });

  it('a rejection needs no second review and tells the student why', async () => {
    const doc = await run(() => service.submitByStudent({ userId: ids.yemen, role: 'STUDENT', schoolId }, { type: 'visit_visa' }, [upload()]));
    const r = await run(() => service.review(doc._id, admin, { decision: 'rejected', reason: 'الصورة غير واضحة' }));
    expect(r).toMatchObject({ status: 'rejected', rejectionReason: 'الصورة غير واضحة' });
    expect(notices.at(-1)).toMatchObject({ recipientId: expect.anything(), type: 'residency_document_reviewed' });
    expect(String(notices.at(-1).recipientId)).toBe(ids.yemen);
    await expect(run(() => service.review(doc._id, admin, { decision: 'approved' }))).rejects.toThrow('من قبل');
  });

  it("the school's upload is approved, and only the school or the student may open the file", async () => {
    const doc = await run(() => service.submitByAdmin(ids.syria, admin, { type: 'other', otherTypeLabel: 'هوية زائر', expiryDate: '2020-01-01' }, [upload()]));
    expect(doc).toMatchObject({ status: 'approved', typeLabel: 'هوية زائر', isExpired: true });
    await expect(run(() => service.filePath(doc._id, 0, { userId: ids.syria, role: 'STUDENT' }))).resolves.toHaveProperty('path');
    await expect(run(() => service.filePath(doc._id, 0, { userId: ids.egypt, role: 'STUDENT' }))).rejects.toThrow('صلاحية');
    await expect(run(() => service.filePath(doc._id, 0, { userId: admin.userId, role: 'TEACHER' }))).rejects.toThrow('صلاحية');
  });

  it('statistics show who has no document, who waits, and whose document expired', async () => {
    const r = await run(() => stats.getStatistics());
    expect(r.residency.nonSaudi).toBe(3);
    expect(r.residency.pending.map((s: any) => s._id)).toEqual([ids.egypt]);
    expect(r.residency.missing.map((s: any) => s._id)).toEqual([ids.yemen]); // rejected counts as missing
    expect(r.residency.expired.map((s: any) => s._id)).toEqual([ids.syria]);
    expect(r.residency.valid).toBe(0);
  });
});
