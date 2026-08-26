import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** One day of the school week. Times are "HH:mm" in the school's `timezone`. */
@Schema({ _id: false })
export class WorkDay {
  @Prop({ required: true, enum: WEEKDAYS })
  day: string;

  @Prop({ default: true })
  isWorkingDay: boolean;

  /** null on a day off, and on a working day whose hours are not set. */
  @Prop({ type: String, default: null })
  startTime: string | null;

  @Prop({ type: String, default: null })
  endTime: string | null;
}

const WorkDaySchema = SchemaFactory.createForClass(WorkDay);

@Schema({ _id: false })
export class SchoolSettings {
  @Prop({ type: Types.ObjectId, ref: 'AcademicYear', default: null })
  activeAcademicYearId?: Types.ObjectId;

  @Prop({ default: 'Asia/Riyadh' })
  timezone: string;

  @Prop({ default: 'ar' })
  language: string;

  @Prop({ default: 3, min: 1 })
  termsPerYear: number;

  @Prop({ default: 50, min: 0, max: 100 })
  defaultPassingGrade: number;

  @Prop({ type: [String], default: [] })
  localNationalityCodes: string[];

  @Prop({ type: { lat: Number, lng: Number }, default: null })
  location: { lat: number; lng: number } | null;

  @Prop({ default: 150, min: 20, max: 2000 })
  checkInRadiusMeters: number;

  @Prop({ type: [String], default: [] })
  schoolNetworkIps: string[];

  @Prop({ default: false })
  teacherCheckInEnabled: boolean;

  /**
   * The school week: which days are worked, and the hours on each.
   *
   * Replaces a single workStartTime. One time for the whole week could not
   * express a short day, and — more importantly — it had no notion of a day
   * off at all, so "who was absent today" reported every teacher in the school
   * every Friday.
   *
   * Empty array = nothing configured. Lateness and early leave are then never
   * computed, and every day is treated as a working day, which is the
   * behaviour a school that has not set this up already has.
   */
  @Prop({ type: [WorkDaySchema], default: [] })
  workSchedule: WorkDay[];
}

const SchoolSettingsSchema = SchemaFactory.createForClass(SchoolSettings);

@Schema({ timestamps: true })
export class School extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop()
  logo?: string;

  @Prop()
  phone?: string;

  @Prop({ required: true, trim: true })
  email: string;

  @Prop({ default: 'Saudi Arabia' })
  country: string;

  @Prop()
  city?: string;

  @Prop()
  address?: string;

  @Prop({ default: 'trial' })
  subscriptionPlan: string;

  @Prop({
    required: true,
    enum: ['trialing', 'active', 'past_due', 'suspended', 'cancelled'],
    default: 'trialing',
  })
  subscriptionStatus: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Admin' })
  ownerId?: Types.ObjectId;

  @Prop({ type: SchoolSettingsSchema, default: () => ({}) })
  settings: SchoolSettings;
}

export const SchoolSchema = SchemaFactory.createForClass(School);
// Ensure slug has index
SchoolSchema.index({ slug: 1 }, { unique: true });
