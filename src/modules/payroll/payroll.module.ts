import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { CommissionService } from './commission.service';
import { CommissionController } from './commission.controller';
import { Payroll, PayrollSchema } from './schemas/payroll.schema';
import {
  PayrollConfig,
  PayrollConfigSchema,
} from './schemas/payroll-config.schema';
import { Commission, CommissionSchema } from './schemas/commission.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { Expense, ExpenseSchema } from '../finance/schemas/expense.schema';
import { BackupModule } from '../backup/backup.module';

@Module({
  imports: [
    BackupModule,
    MongooseModule.forFeature([
      { name: Payroll.name, schema: PayrollSchema },
      { name: PayrollConfig.name, schema: PayrollConfigSchema },
      { name: Commission.name, schema: CommissionSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
  ],
  controllers: [CommissionController, PayrollController],
  providers: [PayrollService, CommissionService],
  exports: [PayrollService, CommissionService],
})
export class PayrollModule {}
