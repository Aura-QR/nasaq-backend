import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { PaymentStatus, FeeStatus } from '../enums/payment-status.enum';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ _id: false })
class DiscountSnapshot {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Discount', required: true })
  discountId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 0 })
  percentage: number;

  @Prop({ required: true, min: 0 })
  discountAmount: number;
}
const DiscountSnapshotSchema = SchemaFactory.createForClass(DiscountSnapshot);

@Schema({ _id: false })
export class SurchargeSnapshot {
  @Prop({ required: true, min: 0 })
  percentage: number;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  nationalityCode: string;
}
export const SurchargeSnapshotSchema = SchemaFactory.createForClass(SurchargeSnapshot);

@Schema({ _id: false })
class PaymentEvent {
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  paidAt: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  recordedBy: mongoose.Types.ObjectId;

  @Prop()
  notes: string;

  @Prop({ enum: ['payment', 'refund'], default: 'payment' })
  type: string;

  /**
   * When the entry was written — not `paidAt`, which is the date the cashier
   * typed and may be days earlier. "Same day" for voiding is measured from
   * this.
   *
   * Deliberately no default. Entries recorded before this field existed have
   * no recording time, and a default would stamp them "now" the moment the
   * record is loaded — letting anyone void any old payment as if it had been
   * entered today. Without one, those entries can only be voided by the owner.
   */
  @Prop({ type: Date })
  recordedAt?: Date;

  /**
   * Set when the entry is voided: it was recorded by mistake and the money
   * never changed hands. The entry stays in the array — a void is part of the
   * record, not a way to rewrite it — and its amount is taken back out of the
   * installment's `paidAmount`. Distinct from a refund, which is money that
   * did change hands and was then returned.
   */
  @Prop({ type: Date })
  voidedAt?: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId })
  voidedBy?: mongoose.Types.ObjectId;

  @Prop()
  voidReason?: string;
}
const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);

@Schema({ _id: true })
class Installment {
  @Prop({ required: true })
  installmentNumber: number;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Prop({ default: 0 })
  paidAmount: number;

  @Prop({ type: [PaymentEventSchema], default: [] })
  payments: PaymentEvent[];
}
const InstallmentSchema = SchemaFactory.createForClass(Installment);

@Schema({ _id: true })
class TripRecord {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTrip', default: null })
  tripTemplateId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  fee: number;

  @Prop({ type: DiscountSnapshotSchema, default: null })
  discount: DiscountSnapshot | null;

  @Prop({ default: 0 })
  netFee: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'InstallmentPlan', default: null })
  installmentPlanId: mongoose.Types.ObjectId;

  @Prop({ enum: FeeStatus, default: FeeStatus.UNPAID })
  status: FeeStatus;

  @Prop({ default: 0 })
  totalPaid: number;

  @Prop({ type: [InstallmentSchema], default: [] })
  installments: Installment[];
}
const TripRecordSchema = SchemaFactory.createForClass(TripRecord);

@Schema({ _id: false })
class BusRecord {
  @Prop({ default: false })
  enrolled: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'BusPlan', default: null })
  busPlanId: mongoose.Types.ObjectId | null;

  @Prop()
  planName: string;

  @Prop({ enum: ['pickup', 'dropoff', 'both'], default: 'both' })
  serviceType: string;

  @Prop({ default: 0 })
  fee: number;

  @Prop({ type: DiscountSnapshotSchema, default: null })
  discount: DiscountSnapshot | null;

  @Prop({ default: 0 })
  netFee: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'InstallmentPlan', default: null })
  installmentPlanId: mongoose.Types.ObjectId;

  @Prop({ enum: FeeStatus, default: FeeStatus.UNPAID })
  status: FeeStatus;

  @Prop({ default: 0 })
  totalPaid: number;

  @Prop({ type: [InstallmentSchema], default: [] })
  installments: Installment[];
}
const BusRecordSchema = SchemaFactory.createForClass(BusRecord);

@Schema({ _id: false })
class TuitionRecord {
  @Prop({ required: true, min: 0 })
  fee: number;

  @Prop({ type: SurchargeSnapshotSchema, default: null })
  surcharge: SurchargeSnapshot | null;

  @Prop({ default: 0 })
  grossFee: number;

  @Prop({ type: DiscountSnapshotSchema, default: null })
  discount: DiscountSnapshot | null;

  @Prop({ default: 0 })
  netFee: number;

  @Prop({ enum: FeeStatus, default: FeeStatus.UNPAID })
  status: FeeStatus;

  @Prop({ default: 0 })
  totalPaid: number;

  @Prop({ type: [InstallmentSchema], default: [] })
  installments: Installment[];
}
const TuitionRecordSchema = SchemaFactory.createForClass(TuitionRecord);

@Schema({ _id: true })
class StudentAdditionalFee {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AdditionalFee', required: true })
  additionalFeeId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ enum: ['unpaid', 'paid'], default: 'unpaid' })
  status: string;

  @Prop({ default: 0 })
  paidAmount: number;

  @Prop({ type: [PaymentEventSchema], default: [] })
  payments: PaymentEvent[];
}
const StudentAdditionalFeeSchema = SchemaFactory.createForClass(StudentAdditionalFee);

@Schema({ collection: 'studentFinancialRecords', timestamps: true })
export class StudentFinancialRecord extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true })
  classId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'FeeConfig', required: true })
  feeConfigId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'InstallmentPlan', default: null })
  installmentPlanId: mongoose.Types.ObjectId | null;

  @Prop({ type: TuitionRecordSchema, required: true })
  tuition: TuitionRecord;

  @Prop({
    type: BusRecordSchema,
    default: () => ({ enrolled: false, serviceType: 'both', fee: 0, totalPaid: 0, status: FeeStatus.UNPAID, installments: [] }),
  })
  bus: BusRecord;

  @Prop({ type: [TripRecordSchema], default: [] })
  trips: TripRecord[];

  @Prop({ type: [StudentAdditionalFeeSchema], default: [] })
  additionalFees: StudentAdditionalFee[];
}

export const StudentFinancialRecordSchema = SchemaFactory.createForClass(StudentFinancialRecord);
StudentFinancialRecordSchema.plugin(tenantScopedPlugin);

StudentFinancialRecordSchema.index({ schoolId: 1, studentId: 1, academicYearId: 1 }, { unique: true });
StudentFinancialRecordSchema.index({ schoolId: 1, 'trips.tripTemplateId': 1 });
StudentFinancialRecordSchema.index({ schoolId: 1, 'bus.enrolled': 1 });
