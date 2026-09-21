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

  /**
   * Periods on this day, when it differs from the school's usual number.
   *
   * Real weeks are rarely uniform — eight periods early in the week and six on
   * the last day is ordinary. A single school-wide number forced a choice
   * between under-using the long days and scheduling lessons into periods the
   * short day does not have. null means "use the school's number".
   */
  @Prop({ type: Number, default: null, min: 1, max: 10 })
  periodsPerDay: number | null;
}

const WorkDaySchema = SchemaFactory.createForClass(WorkDay);

/**
 * A stretch of days the school does not work, on top of its weekly days off.
 *
 * A range rather than a list of dates: a mid-term break is one thing with a
 * name, and asking somebody to enter ten separate days is how a feature goes
 * unused. A single day is a range whose ends are equal.
 *
 * Dates are stored at UTC midnight, the same key every attendance record uses,
 * so a comparison never has to reason about the hour.
 */
@Schema({ _id: true })
export class SchoolHoliday {
  /** Shown wherever a day is explained as non-working — "إجازة منتصف الفصل". */
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Date, required: true })
  startDate: Date;

  /** Inclusive. Equal to startDate for a single day. */
  @Prop({ type: Date, required: true })
  endDate: Date;
}

const SchoolHolidaySchema = SchemaFactory.createForClass(SchoolHoliday);

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

  @Prop({ default: false })
  staffCheckInEnabled: boolean;

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

  /**
   * Teaching periods in a school day.
   *
   * `Lecture.slot` accepts 1–10, but nothing recorded how many the school
   * actually runs — so there was no way to know a week's capacity, which is
   * what decides whether a timetable can exist at all.
   */
  @Prop({ default: 7, min: 1, max: 10 })
  periodsPerDay: number;

  /**
   * Days off the weekly schedule cannot express.
   *
   * `workSchedule` says which weekdays are worked, which is right for a
   * Friday and useless for Eid. Without this, a mid-term break counted as
   * absence against every teacher in the school, and the monthly report
   * measured everyone against days nobody was asked to come in on.
   *
   * Empty = the behaviour before this existed.
   */
  @Prop({ type: [SchoolHolidaySchema], default: [] })
  holidays: SchoolHoliday[];
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
