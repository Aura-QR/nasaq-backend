import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeeConfig, FeeConfigSchema } from './schemas/fee-config.schema';
import { InstallmentPlan, InstallmentPlanSchema } from './schemas/installment-plan.schema';
import { StudentFinancialRecord, StudentFinancialRecordSchema } from './schemas/student-financial-record.schema';
import { Discount, DiscountSchema } from './schemas/discount.schema';
import { AdditionalFee, AdditionalFeeSchema } from './schemas/additional-fee.schema';
import { AdditionalFeeService } from './additional-fee.service';
import { AdditionalFeeController } from './additional-fee.controller';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { CaslModule } from '../casl/casl.module';
import { FeeConfigService } from './fee-config.service';
import { FeeConfigController } from './fee-config.controller';
import { InstallmentPlanService } from './installment-plan.service';
import { InstallmentPlanController } from './installment-plan.controller';
import { FinancialRecordService } from './financial-record.service';
import { FinancialRecordController } from './financial-record.controller';
import { BusService } from './bus.service';
import { BusController } from './bus.controller';
import { BusModuleController } from './bus-module.controller';
import { TripService } from './trip.service';
import { TripController } from './trip.controller';
import { TripModuleController } from './trip-module.controller';
import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';
import { FinancialTrip, FinancialTripSchema } from './schemas/financial-trip.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeeConfig.name, schema: FeeConfigSchema },
      { name: InstallmentPlan.name, schema: InstallmentPlanSchema },
      { name: StudentFinancialRecord.name, schema: StudentFinancialRecordSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: AdditionalFee.name, schema: AdditionalFeeSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: FinancialTrip.name, schema: FinancialTripSchema },
    ]),
    CaslModule,
  ],
  controllers: [
    FeeConfigController,
    InstallmentPlanController,
    FinancialRecordController,
    BusController,
    BusModuleController,
    TripController,
    TripModuleController,
    DiscountController,
    AdditionalFeeController,
  ],
  providers: [
    FeeConfigService,
    InstallmentPlanService,
    FinancialRecordService,
    BusService,
    TripService,
    DiscountService,
    AdditionalFeeService,
  ],
  exports: [FinancialRecordService],
})
export class FinancialModule {}
