import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';

import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';
import { Installment, InstallmentSchema } from './schemas/installment.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Revenue, RevenueSchema } from './schemas/revenue.schema';
import { Expense, ExpenseSchema } from './schemas/expense.schema';

import { SubscriptionsService } from './services/subscriptions.service';
import { InstallmentsService } from './services/installments.service';
import { PaymentsService } from './services/payments.service';
import { RevenueService } from './services/revenue.service';
import { ExpensesService } from './services/expenses.service';
import { ReportsService } from './services/reports.service';

import { SubscriptionsController } from './controllers/subscriptions.controller';
import { InstallmentsController } from './controllers/installments.controller';
import { PaymentsController } from './controllers/payments.controller';
import { RevenueController } from './controllers/revenue.controller';
import { ExpensesController } from './controllers/expenses.controller';
import { ReportsController } from './controllers/reports.controller';

import { FinanceGateway } from './finance.gateway';
import { FinanceScheduler } from './finance.scheduler';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Installment.name, schema: InstallmentSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Revenue.name, schema: RevenueSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    MulterModule.register({
      dest: join(process.cwd(), 'uploads', 'expenses'),
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    SubscriptionsController,
    InstallmentsController,
    PaymentsController,
    RevenueController,
    ExpensesController,
    ReportsController,
  ],
  providers: [
    FinanceGateway,
    FinanceScheduler,
    SubscriptionsService,
    InstallmentsService,
    PaymentsService,
    RevenueService,
    ExpensesService,
    ReportsService,
  ],
  exports: [ReportsService],
})
export class FinanceModule {}
