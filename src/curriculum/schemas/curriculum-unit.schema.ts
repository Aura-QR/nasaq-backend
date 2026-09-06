import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as M, Types } from 'mongoose';
import { tenantScopedPlugin } from '../../tenancy/plugins/tenant-scoped.plugin';
@Schema({ collection: 'curriculum_units', timestamps: true })
export class CurriculumUnit extends Document {
  @Prop({ type: M.Types.ObjectId, ref: 'Subject', required: true })
  subjectId: Types.ObjectId;
  @Prop({ type: M.Types.ObjectId, ref: 'GradeLevel', required: true })
  gradeLevelId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, min: 0 }) order: number;
  @Prop({ type: M.Types.ObjectId, ref: 'CatalogUnit', default: null })
  catalogUnitId: Types.ObjectId;
}
export const CurriculumUnitSchema =
  SchemaFactory.createForClass(CurriculumUnit);
CurriculumUnitSchema.plugin(tenantScopedPlugin);
CurriculumUnitSchema.index({
  schoolId: 1,
  subjectId: 1,
  gradeLevelId: 1,
  order: 1,
});
CurriculumUnitSchema.index(
  { schoolId: 1, subjectId: 1, gradeLevelId: 1, catalogUnitId: 1 },
  {
    unique: true,
    partialFilterExpression: { catalogUnitId: { $type: 'objectId' } },
  },
);
