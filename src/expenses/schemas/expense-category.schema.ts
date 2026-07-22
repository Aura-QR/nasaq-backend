import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { tenantScopedPlugin } from 'src/tenancy/plugins/tenant-scoped.plugin';

@Schema({ collection: 'expenseCategories', timestamps: true })
export class ExpenseCategory extends Document {
  @Prop({ required: true, index: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const ExpenseCategorySchema = SchemaFactory.createForClass(ExpenseCategory);
ExpenseCategorySchema.plugin(tenantScopedPlugin);

ExpenseCategorySchema.index({ schoolId: 1, name: 1 }, { unique: true });
