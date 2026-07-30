import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class AcademicYear extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, enum: ['active', 'archived'], default: 'active' })
  status: string;

  @Prop({ default: 0, min: 0, max: 7 })
  setupStep: number;
}

export const AcademicYearSchema = SchemaFactory.createForClass(AcademicYear);
AcademicYearSchema.plugin(tenantScopedPlugin);
AcademicYearSchema.index({ schoolId: 1, name: 1 }, { unique: true });
AcademicYearSchema.index({ schoolId: 1, status: 1 });
