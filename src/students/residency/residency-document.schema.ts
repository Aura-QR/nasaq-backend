import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

export const RESIDENCY_DOCUMENT_TYPES = ['iqama', 'visit_visa', 'passport', 'other'] as const;
export const RESIDENCY_DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;

@Schema({ _id: false })
export class ResidencyDocumentFile {
  /** Generated name under `uploads/.private/residency`; never served statically. */
  @Prop({ required: true })
  storedName: string;

  @Prop()
  originalName: string;

  @Prop()
  mimeType: string;

  @Prop()
  size: number;
}
const ResidencyDocumentFileSchema = SchemaFactory.createForClass(ResidencyDocumentFile);

/**
 * A non-Saudi student's residency document (iqama, visit visa, passport),
 * which the ministry reviews. A family's upload waits for the school's review;
 * the school's own upload counts as approved. Every submission is kept, so the
 * student's current document is the latest approved one.
 */
@Schema({ timestamps: true })
export class StudentResidencyDocument extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: mongoose.Types.ObjectId;

  @Prop({ required: true, enum: RESIDENCY_DOCUMENT_TYPES })
  type: string;

  /** The document's name when `type` is `other`. */
  @Prop({ default: null })
  otherTypeLabel: string | null;

  @Prop({ default: null })
  documentNumber: string | null;

  @Prop({ type: Date, default: null })
  issueDate: Date | null;

  @Prop({ type: Date, default: null })
  expiryDate: Date | null;

  @Prop({ type: [ResidencyDocumentFileSchema], default: [] })
  files: ResidencyDocumentFile[];

  @Prop({ required: true, enum: RESIDENCY_DOCUMENT_STATUSES, default: 'pending', index: true })
  status: string;

  @Prop({ default: null })
  rejectionReason: string | null;

  @Prop({ required: true })
  uploadedByRole: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  uploadedById: mongoose.Types.ObjectId | null;

  @Prop({ type: mongoose.Schema.Types.ObjectId, default: null })
  reviewedById: mongoose.Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const StudentResidencyDocumentSchema = SchemaFactory.createForClass(StudentResidencyDocument);
StudentResidencyDocumentSchema.plugin(tenantScopedPlugin);
StudentResidencyDocumentSchema.index({ schoolId: 1, studentId: 1, createdAt: -1 });
StudentResidencyDocumentSchema.index({ schoolId: 1, status: 1, createdAt: -1 });
