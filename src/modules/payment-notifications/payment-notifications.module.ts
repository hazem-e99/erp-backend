import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentNotificationsScheduler } from './payment-notifications.scheduler';
import { AnnouncementsModule } from '../announcements/announcements.module';
import {
  PayrollConfig,
  PayrollConfigSchema,
} from '../payroll/schemas/payroll-config.schema';
import {
  Payroll,
  PayrollSchema,
} from '../payroll/schemas/payroll.schema';
import {
  Installment,
  InstallmentSchema,
} from '../finance/schemas/installment.schema';

@Module({
  imports: [
    AnnouncementsModule,
    MongooseModule.forFeature([
      { name: PayrollConfig.name, schema: PayrollConfigSchema },
      { name: Payroll.name, schema: PayrollSchema },
      { name: Installment.name, schema: InstallmentSchema },
    ]),
  ],
  providers: [PaymentNotificationsScheduler],
})
export class PaymentNotificationsModule {}
