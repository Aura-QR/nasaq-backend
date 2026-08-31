import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class SubjectOffering extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Term', required: true, index: true })
  termId: mongoose.Types.ObjectId;

  /**
   * How many periods a week this subject gets, for every class in this grade.
   *
   * The teaching plan lives here rather than on the class because it is set
   * per grade: "grade 4 maths, term 1 = 6 periods" applies to 4/1, 4/2 and
   * 4/3 alike. It is what the timetable generator schedules against.
   *
   * 0 means unplanned — the generator skips it rather than guessing.
   */
  @Prop({ type: Number, default: 0, min: 0, max: 20 })
  periodsPerWeek: number;
}

export const SubjectOfferingSchema = SchemaFactory.createForClass(SubjectOffering);
SubjectOfferingSchema.plugin(tenantScopedPlugin);
SubjectOfferingSchema.index({ schoolId: 1, subjectId: 1, gradeLevelId: 1, termId: 1 }, { unique: true });
