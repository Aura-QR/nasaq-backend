import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ timestamps: true })
export class Term extends Document {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true })
  academicYearId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  order: number;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, enum: ['upcoming', 'active', 'closed'], default: 'upcoming' })
  status: string;
}

export const TermSchema = SchemaFactory.createForClass(Term);
TermSchema.plugin(tenantScopedPlugin);
TermSchema.index({ schoolId: 1, academicYearId: 1, order: 1 }, { unique: true });
TermSchema.index({ schoolId: 1, academicYearId: 1, status: 1 });
