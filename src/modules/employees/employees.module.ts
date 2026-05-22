import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import {
  EmployeeSettlement,
  EmployeeSettlementSchema,
} from './schemas/employee-settlement.schema';
import { Payroll, PayrollSchema } from '../payroll/schemas/payroll.schema';
import {
  PayrollConfig,
  PayrollConfigSchema,
} from '../payroll/schemas/payroll-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: EmployeeSettlement.name, schema: EmployeeSettlementSchema },
      { name: Payroll.name, schema: PayrollSchema },
      { name: PayrollConfig.name, schema: PayrollConfigSchema },
    ]),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
