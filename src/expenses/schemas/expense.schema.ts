import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'expenses', timestamps: true })
export class Expense extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true })
  categoryId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', default: null, index: true })
  academicYearId: mongoose.Types.ObjectId | null;

  @Prop()
  notes: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.plugin(tenantScopedPlugin);

ExpenseSchema.index({ schoolId: 1, categoryId: 1 });
ExpenseSchema.index({ schoolId: 1, date: -1 });
ExpenseSchema.index({ schoolId: 1, academicYearId: 1 });
