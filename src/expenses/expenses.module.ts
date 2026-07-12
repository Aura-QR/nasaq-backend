import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CaslModule } from '../casl/casl.module';
import { ExpenseCategory, ExpenseCategorySchema } from './schemas/expense-category.schema';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { ExpenseCategoryService } from './expense-category.service';
import { ExpenseCategoryController } from './expense-category.controller';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    CaslModule,
  ],
  controllers: [ExpenseCategoryController, ExpenseController],
  providers: [ExpenseCategoryService, ExpenseService],
})
export class ExpensesModule {}
