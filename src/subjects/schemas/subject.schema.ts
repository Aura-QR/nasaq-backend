import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Subject extends Document {
  @Prop({ required: true })
  subjectName: string;

  @Prop({ required: false })
  subjectCode?: string;

  @Prop({ default: true })
  isRequiredForPromotion: boolean;

  /**
   * «نشاط غير دراسي» — breakfast, play, the morning circle. On the timetable,
   * but never prepared, tracked or graded. See subjects/activity.util.ts.
   */
  @Prop({ type: Boolean, default: false })
  isActivity: boolean;

  /**
   * Ministry template only: «تقويم مستمر» (40 + 60) or «تقويم ختامي»
   * (40 + 20 + 40). null — not in the annual register. A subject offering may
   * override it for one grade. Ignored by the flexible system.
   */
  @Prop({ type: String, enum: ['continuous', 'final_exam', null], default: null })
  assessmentType: 'continuous' | 'final_exam' | null;

  /** Ministry template: this subject's pass mark out of 100; null — the school's. */
  @Prop({ type: Number, min: 0, max: 100, default: null })
  passingGrade: number | null;
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.plugin(tenantScopedPlugin);

SubjectSchema.index({ schoolId: 1, subjectName: 1 });