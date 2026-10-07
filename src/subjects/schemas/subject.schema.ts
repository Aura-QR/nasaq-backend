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
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.plugin(tenantScopedPlugin);

SubjectSchema.index({ schoolId: 1, subjectName: 1 });