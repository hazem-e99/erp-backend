import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { Payroll, PayrollSchema } from './schemas/payroll.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { Leave, LeaveSchema } from '../leaves/schemas/leave.schema';
import { Expense, ExpenseSchema } from '../finance/schemas/expense.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payroll.name, schema: PayrollSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Leave.name, schema: LeaveSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    MulterModule.register({
      dest: join(process.cwd(), 'uploads', 'payroll'),
    }),
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
