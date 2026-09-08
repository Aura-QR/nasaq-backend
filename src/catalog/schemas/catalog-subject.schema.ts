import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * One course in the platform catalogue — a subject as a ministry publishes it,
 * for one grade and one term.
 *
 * `name` alone does not identify it. The national curriculum has 35 separate
 * science courses and 24 maths courses, so a picker showing only the subject
 * offers the same word two dozen times. `variant` is the course's own label
 * from the source — usually its first unit — and together with the unit
 * preview and the counts it is what lets a deputy head with the book open
 * recognise the one she is holding.
 */
@Schema({ collection: 'catalog_subjects', timestamps: true })
export class CatalogSubject extends Document {
  /** The subject a school would recognise: العلوم, الرياضيات, اللغة العربية. */
  @Prop({ required: true, trim: true }) name: string;

  /**
   * What tells two courses of the same subject apart, from the source data.
   * Empty only for a source that has nothing better to offer.
   */
  @Prop({ default: '', trim: true }) variant: string;

  /**
   * The grade this course belongs to, when the source says so.
   *
   * A hint for the picker, never a key: schools name their grades differently
   * (مواهب alone carries both "الصف السادس" and "الصف السادس إبتدائى"), so the
   * grade an import actually lands on is the school's own, chosen at import.
   */
  @Prop({ default: '', trim: true }) gradeName: string;

  // Denormalised so the picker can show what a course contains without a
  // second query per row. This collection is written once by a seed and read
  // by everyone; there is nothing here to drift.
  @Prop({ default: 0, min: 0 }) unitCount: number;
  @Prop({ default: 0, min: 0 }) lessonCount: number;
  @Prop({ type: [String], default: [] }) unitPreview: string[];

  @Prop({ required: true, unique: true }) sourceId: string;
}
export const CatalogSubjectSchema =
  SchemaFactory.createForClass(CatalogSubject);

// The picker's only query: find by subject or by the variant that
// distinguishes it.
CatalogSubjectSchema.index({ name: 1, variant: 1 });
