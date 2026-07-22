import * as mongoose from 'mongoose';
import { TenantContextService } from './tenant-context.service';
import { FeeConfigSchema } from 'src/financial/schemas/fee-config.schema';
import { ExpenseCategorySchema } from 'src/expenses/schemas/expense-category.schema';
import { ExpenseSchema } from 'src/expenses/schemas/expense.schema';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Financial & Expense Modules Tenancy Isolation', () => {
  const contextService = new TenantContextService();
  const schoolIdA = new mongoose.Types.ObjectId().toString();
  const schoolIdB = new mongoose.Types.ObjectId().toString();
  const dummyAdminId = new mongoose.Types.ObjectId();

  let feeConfigModel: any;
  let categoryModel: any;
  let expenseModel: any;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await mongoose.connect(mongoUri);

    try { feeConfigModel = mongoose.model('TestFeeConfig', FeeConfigSchema); } catch { feeConfigModel = mongoose.model('TestFeeConfig'); }
    try { categoryModel = mongoose.model('TestExpenseCategory', ExpenseCategorySchema); } catch { categoryModel = mongoose.model('TestExpenseCategory'); }
    try { expenseModel = mongoose.model('TestExpense', ExpenseSchema); } catch { expenseModel = mongoose.model('TestExpense'); }

    try { await feeConfigModel.collection.dropIndex('academicYear_1'); } catch {}
    try { await categoryModel.collection.dropIndex('name_1'); } catch {}
  });

  afterAll(async () => {
    try {
      await feeConfigModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await categoryModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await expenseModel.deleteMany({}).setOptions({ skipTenantScope: true });
    } catch {}
    await mongoose.disconnect();
  });

  it('should allow identical academicYear FeeConfig across different schools (compound unique index)', async () => {
    const academicYear = '2026/2027';

    // School A creates FeeConfig
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const configA = await feeConfigModel.create({
        academicYear,
        tuitionFee: 5000,
        createdBy: dummyAdminId,
      });
      expect(configA.schoolId.toString()).toEqual(schoolIdA);
    });

    // School B creates FeeConfig for the SAME academicYear
    await contextService.runWithTenant(schoolIdB, false, async () => {
      const configB = await feeConfigModel.create({
        academicYear,
        tuitionFee: 7500,
        createdBy: dummyAdminId,
      });
      expect(configB.schoolId.toString()).toEqual(schoolIdB);
    });

    // Verify School A only sees its own FeeConfig
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const foundA = await feeConfigModel.findOne({ academicYear });
      expect(foundA.tuitionFee).toEqual(5000);
    });
  });

  it('should isolate ExpenseCategories and Expenses per school', async () => {
    let catAId: string = '';

    await contextService.runWithTenant(schoolIdA, false, async () => {
      const catA = await categoryModel.create({
        name: 'Maintenance',
        createdBy: dummyAdminId,
      });
      catAId = catA._id.toString();

      await expenseModel.create({
        name: 'AC Repair',
        amount: 300,
        categoryId: catA._id,
        date: new Date(),
        createdBy: dummyAdminId,
      });
    });

    // School B context cannot see School A expenses or categories
    await contextService.runWithTenant(schoolIdB, false, async () => {
      const catInB = await categoryModel.findById(catAId);
      expect(catInB).toBeNull();

      const expensesInB = await expenseModel.find({});
      expect(expensesInB.length).toEqual(0);
    });
  });
});
