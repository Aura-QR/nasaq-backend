import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import { join } from 'path';
import { Student } from '../schemas/student.schema';
import { Class } from '../../classes/schemas/class.schema';
import { Admin } from '../../admin/schemas/admin.schema';
import { StudentResidencyDocument } from './residency-document.schema';
import { ReviewResidencyDocumentDto, SubmitResidencyDocumentDto } from './residency-document.dto';
import { RESIDENCY_UPLOAD_DIR } from './multer-residency.config';
import { resolveNationalityCode } from '../../common/constants/nationalities.constant';
import { NotificationsService } from '../../notifications/notifications.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { adminsWhoCanRead } from '../../notifications/admin-audience';

const ADMIN_ROLES = ['OWNER', 'SUPERVISOR', 'MANAGER', 'SUPER_ADMIN'];

export const RESIDENCY_TYPE_LABELS: Record<string, string> = {
  iqama: 'إقامة',
  visit_visa: 'تأشيرة زيارة',
  passport: 'جواز سفر',
  other: 'أخرى',
};

interface UploadedFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

interface Actor {
  userId: string;
  role: string;
  schoolId?: string;
}

@Injectable()
export class ResidencyDocumentsService {
  private readonly logger = new Logger(ResidencyDocumentsService.name);

  constructor(
    @InjectModel(StudentResidencyDocument.name) private documentModel: Model<StudentResidencyDocument>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(Admin.name) private adminModel: Model<Admin>,
    private notifications: NotificationsService,
    private permissions?: PermissionsService,
  ) {}

  /**
   * A student's (or family's) upload. It waits for the school's review; a
   * second upload while one is still waiting replaces it, so a family that
   * picked the wrong photo does not leave two in the school's queue.
   */
  async submitByStudent(actor: Actor, dto: SubmitResidencyDocumentDto, files: UploadedFile[]) {
    const student = await this.loadNonSaudiStudent(actor.userId, files);

    const previous = await this.documentModel.find({ studentId: student._id, status: 'pending' }).exec();
    for (const doc of previous) {
      this.removeFiles(doc);
      await doc.deleteOne();
    }

    const doc = await this.create(student._id as Types.ObjectId, dto, files, actor, 'pending');
    void this.notifyAdmins(student, doc, actor.schoolId);
    return this.present(doc);
  }

  /** The school's own upload: it has the document in hand, so it is approved as filed. */
  async submitByAdmin(studentId: string, actor: Actor, dto: SubmitResidencyDocumentDto, files: UploadedFile[]) {
    const student = await this.loadNonSaudiStudent(studentId, files);
    const doc = await this.create(student._id as Types.ObjectId, dto, files, actor, 'approved');
    return this.present(doc);
  }

  async review(documentId: string, actor: Actor, dto: ReviewResidencyDocumentDto) {
    const doc = await this.findDocument(documentId);
    if (doc.status !== 'pending') {
      throw new BadRequestException('تمت مراجعة هذه الوثيقة من قبل');
    }

    doc.status = dto.decision;
    doc.rejectionReason = dto.decision === 'rejected' ? dto.reason!.trim() : null;
    doc.reviewedById = new Types.ObjectId(actor.userId);
    doc.reviewedAt = new Date();
    await doc.save();

    void this.notifications.notify({
      recipientId: doc.studentId,
      type: 'residency_document_reviewed',
      title: dto.decision === 'approved' ? 'تم قبول وثيقة الإقامة' : 'تم رفض وثيقة الإقامة',
      body:
        dto.decision === 'approved'
          ? `قبلت المدرسة ${RESIDENCY_TYPE_LABELS[doc.type]} المرفوعة.`
          : `السبب: ${doc.rejectionReason}. يرجى رفع الوثيقة مرة أخرى.`,
      data: { documentId: String(doc._id), status: doc.status },
    });

    return this.present(doc);
  }

  async remove(documentId: string) {
    const doc = await this.findDocument(documentId);
    this.removeFiles(doc);
    await doc.deleteOne();
    return { message: 'تم حذف الوثيقة' };
  }

  /** The student's submissions, newest first, and the one that counts now. */
  async listForStudent(studentId: string) {
    if (!Types.ObjectId.isValid(studentId)) throw new BadRequestException('معرّف الطالب غير صالح');
    const docs = await this.documentModel.find({ studentId: new Types.ObjectId(studentId) }).sort({ createdAt: -1 }).exec();
    const current = docs.find((d) => d.status === 'approved') ?? null;
    return {
      current: current ? this.present(current) : null,
      documents: docs.map((d) => this.present(d)),
    };
  }

  /** The school's review queue, with each student's name and class. */
  async list(status = 'pending') {
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new BadRequestException('الحالة يجب أن تكون pending أو approved أو rejected');
    }
    const docs = await this.documentModel.find({ status }).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(200).exec();
    const students = await this.studentModel
      .find({ _id: { $in: docs.map((d) => d.studentId) } })
      .select('_id name firstName fatherName familyName classId nationality nationalityCode')
      .lean()
      .exec();
    const classes = await this.classModel
      .find({ _id: { $in: students.map((s: any) => s.classId).filter(Boolean) } })
      .select('_id name')
      .lean()
      .exec();
    const studentById = new Map(students.map((s: any) => [String(s._id), s]));
    const classById = new Map(classes.map((c: any) => [String(c._id), c.name]));

    return docs.map((d) => {
      const s: any = studentById.get(String(d.studentId));
      return {
        ...this.present(d),
        student: s
          ? { _id: String(s._id), name: studentName(s), className: classById.get(String(s.classId)) ?? null, nationality: s.nationality ?? null }
          : null,
      };
    });
  }

  /** Where a file is on disk, once the caller is shown to be allowed to see it. */
  async filePath(documentId: string, index: number, actor: Actor) {
    const doc = await this.findDocument(documentId);
    const isAdmin = ADMIN_ROLES.includes(actor.role);
    const isOwner = actor.role === 'STUDENT' && String(doc.studentId) === String(actor.userId);
    if (!isAdmin && !isOwner) throw new ForbiddenException('ليس لديك صلاحية لعرض هذه الوثيقة');

    const file = doc.files[index];
    if (!file) throw new NotFoundException('الملف غير موجود');
    const path = join(process.cwd(), RESIDENCY_UPLOAD_DIR, file.storedName);
    if (!fs.existsSync(path)) throw new NotFoundException('الملف غير موجود');
    return { path, mimeType: file.mimeType, originalName: file.originalName };
  }

  private async loadNonSaudiStudent(studentId: string, files: UploadedFile[]) {
    const fail = (error: Error) => {
      this.discard(files);
      throw error;
    };
    if (!files?.length) fail(new BadRequestException('يرجى إرفاق صورة الوثيقة'));
    if (!Types.ObjectId.isValid(studentId)) fail(new BadRequestException('معرّف الطالب غير صالح'));

    const student = await this.studentModel.findById(studentId).select('_id name firstName fatherName familyName nationality nationalityCode').exec();
    if (!student) fail(new NotFoundException('الطالب غير موجود'));
    if (resolveNationalityCode(student!.nationalityCode, student!.nationality) === 'SA') {
      fail(new BadRequestException('وثيقة الإقامة مطلوبة للطلاب غير السعوديين فقط'));
    }
    return student!;
  }

  private async create(studentId: Types.ObjectId, dto: SubmitResidencyDocumentDto, files: UploadedFile[], actor: Actor, status: string) {
    if (dto.issueDate && dto.expiryDate && new Date(dto.expiryDate) <= new Date(dto.issueDate)) {
      this.discard(files);
      throw new BadRequestException('تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار');
    }
    const reviewed = status === 'approved';
    return this.documentModel.create({
      studentId,
      type: dto.type,
      otherTypeLabel: dto.type === 'other' ? dto.otherTypeLabel?.trim() || null : null,
      documentNumber: dto.documentNumber?.trim() || null,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      files: files.map((f) => ({ storedName: f.filename, originalName: f.originalname, mimeType: f.mimetype, size: f.size })),
      status,
      uploadedByRole: actor.role,
      uploadedById: Types.ObjectId.isValid(actor.userId) ? new Types.ObjectId(actor.userId) : null,
      reviewedById: reviewed && Types.ObjectId.isValid(actor.userId) ? new Types.ObjectId(actor.userId) : null,
      reviewedAt: reviewed ? new Date() : null,
    });
  }

  private async notifyAdmins(student: any, doc: StudentResidencyDocument, schoolId?: string) {
    try {
      const sId = schoolId ?? String((doc as any).schoolId ?? '');
      if (!sId) return;
      const admins = await this.adminModel
        .find({ schoolId: new Types.ObjectId(sId), role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] } })
        .select('_id role jobTitleId')
        .setOptions({ skipTenantScope: true })
        .lean()
        .exec();
      const ids = await adminsWhoCanRead(admins as any[], 'students', sId, this.permissions);
      await Promise.all(
        ids.map((id) =>
          this.notifications.notify({
            recipientId: id,
            type: 'residency_document_submitted',
            title: 'وثيقة إقامة بانتظار المراجعة',
            body: `رفع الطالب ${studentName(student)} ${RESIDENCY_TYPE_LABELS[doc.type]}.`,
            data: { documentId: String(doc._id), studentId: String(student._id) },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(`Failed to notify admins of a residency document: ${error.message}`);
    }
  }

  private async findDocument(documentId: string) {
    if (!Types.ObjectId.isValid(documentId)) throw new BadRequestException('معرّف الوثيقة غير صالح');
    const doc = await this.documentModel.findById(documentId).exec();
    if (!doc) throw new NotFoundException('الوثيقة غير موجودة');
    return doc;
  }

  private present(doc: StudentResidencyDocument) {
    return {
      _id: String(doc._id),
      studentId: String(doc.studentId),
      type: doc.type,
      typeLabel: doc.type === 'other' && doc.otherTypeLabel ? doc.otherTypeLabel : RESIDENCY_TYPE_LABELS[doc.type],
      otherTypeLabel: doc.otherTypeLabel,
      documentNumber: doc.documentNumber,
      issueDate: doc.issueDate,
      expiryDate: doc.expiryDate,
      isExpired: !!doc.expiryDate && doc.expiryDate < startOfToday(),
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      uploadedByRole: doc.uploadedByRole,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
      files: doc.files.map((f, i) => ({
        url: `/residency-documents/${doc._id}/files/${i}`,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
      })),
    };
  }

  private removeFiles(doc: StudentResidencyDocument) {
    for (const f of doc.files) {
      fs.promises.unlink(join(process.cwd(), RESIDENCY_UPLOAD_DIR, f.storedName)).catch(() => undefined);
    }
  }

  /** A refused upload must not leave an identity document behind on disk. */
  private discard(files: UploadedFile[]) {
    for (const f of files ?? []) {
      fs.promises.unlink(join(process.cwd(), RESIDENCY_UPLOAD_DIR, f.filename)).catch(() => undefined);
    }
  }
}

export function studentName(s: any): string {
  return s?.name || [s?.firstName, s?.fatherName, s?.familyName].filter(Boolean).join(' ');
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
