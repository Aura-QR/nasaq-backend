import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';

@Schema({ collection: 'expenseCategories', timestamps: true })
export class ExpenseCategory extends Document {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: mongoose.Types.ObjectId;
}

export const ExpenseCategorySchema = SchemaFactory.createForClass(ExpenseCategory);
