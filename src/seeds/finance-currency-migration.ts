/**
 * Migration Script: Add Multi-Currency Support to Finance Module
 * 
 * This script backfills existing financial records with currency fields:
 * - currency: 'EGP' (base currency)
 * - exchangeRate: 1
 * - baseAmount: same as amount (or baseTotalPrice: same as totalPrice)
 * 
 * Run this ONCE after deploying schema changes and BEFORE deploying service logic changes.
 * 
 * Usage:
 *   npx ts-node src/seeds/finance-currency-migration.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment } from '../modules/finance/schemas/payment.schema';
import { Expense } from '../modules/finance/schemas/expense.schema';
import { Revenue } from '../modules/finance/schemas/revenue.schema';
import { Subscription } from '../modules/finance/schemas/subscription.schema';
import { Installment } from '../modules/finance/schemas/installment.schema';
import { Transaction } from '../modules/finance/schemas/transaction.schema';
import { BASE_CURRENCY } from '../modules/finance/constants/currency.constants';

async function migrate() {
  console.log('🚀 Starting multi-currency migration...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  const paymentModel = app.get<Model<Payment>>(getModelToken(Payment.name));
  const expenseModel = app.get<Model<Expense>>(getModelToken(Expense.name));
  const revenueModel = app.get<Model<Revenue>>(getModelToken(Revenue.name));
  const subscriptionModel = app.get<Model<Subscription>>(getModelToken(Subscription.name));
  const installmentModel = app.get<Model<Installment>>(getModelToken(Installment.name));
  const transactionModel = app.get<Model<Transaction>>(getModelToken(Transaction.name));

  try {
    // 1. Migrate Payments
    console.log('📝 Migrating payments...');
    const paymentsResult = await paymentModel.updateMany(
      { currency: { $exists: false } }, // Only records without currency field
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
        $mul: { amount: 1 }, // Trick to copy amount to baseAmount in next step
      },
    );
    // Copy amount to baseAmount
    await paymentModel.updateMany(
      { baseAmount: { $exists: false } },
      [{ $set: { baseAmount: '$amount' } }],
    );
    console.log(`   ✅ Updated ${paymentsResult.modifiedCount} payments\n`);

    // 2. Migrate Expenses
    console.log('📝 Migrating expenses...');
    const expensesResult = await expenseModel.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
      },
    );
    await expenseModel.updateMany(
      { baseAmount: { $exists: false } },
      [{ $set: { baseAmount: '$amount' } }],
    );
    console.log(`   ✅ Updated ${expensesResult.modifiedCount} expenses\n`);

    // 3. Migrate Revenue
    console.log('📝 Migrating revenue entries...');
    const revenueResult = await revenueModel.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
      },
    );
    await revenueModel.updateMany(
      { baseAmount: { $exists: false } },
      [{ $set: { baseAmount: '$amount' } }],
    );
    console.log(`   ✅ Updated ${revenueResult.modifiedCount} revenue entries\n`);

    // 4. Migrate Subscriptions
    console.log('📝 Migrating subscriptions...');
    const subscriptionsResult = await subscriptionModel.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
      },
    );
    await subscriptionModel.updateMany(
      { baseTotalPrice: { $exists: false } },
      [{ $set: { baseTotalPrice: '$totalPrice' } }],
    );
    console.log(`   ✅ Updated ${subscriptionsResult.modifiedCount} subscriptions\n`);

    // 5. Migrate Installments
    console.log('📝 Migrating installments...');
    const installmentsResult = await installmentModel.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
      },
    );
    await installmentModel.updateMany(
      { baseAmount: { $exists: false } },
      [{ $set: { baseAmount: '$amount' } }],
    );
    console.log(`   ✅ Updated ${installmentsResult.modifiedCount} installments\n`);

    // 6. Migrate Legacy Transactions
    console.log('📝 Migrating legacy transactions...');
    const transactionsResult = await transactionModel.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: 1,
        },
      },
    );
    await transactionModel.updateMany(
      { baseAmount: { $exists: false } },
      [{ $set: { baseAmount: '$amount' } }],
    );
    console.log(`   ✅ Updated ${transactionsResult.modifiedCount} transactions\n`);

    // Summary
    console.log('════════════════════════════════════════');
    console.log('✨ Migration completed successfully!\n');
    console.log('Summary:');
    console.log(`   Payments:      ${paymentsResult.modifiedCount}`);
    console.log(`   Expenses:      ${expensesResult.modifiedCount}`);
    console.log(`   Revenue:       ${revenueResult.modifiedCount}`);
    console.log(`   Subscriptions: ${subscriptionsResult.modifiedCount}`);
    console.log(`   Installments:  ${installmentsResult.modifiedCount}`);
    console.log(`   Transactions:  ${transactionsResult.modifiedCount}`);
    console.log('════════════════════════════════════════\n');

    // Verification
    console.log('🔍 Verifying migration...');
    const [paymentsCheck, expensesCheck, revenueCheck, subscriptionsCheck, installmentsCheck] = await Promise.all([
      paymentModel.countDocuments({ currency: { $exists: false } }),
      expenseModel.countDocuments({ currency: { $exists: false } }),
      revenueModel.countDocuments({ currency: { $exists: false } }),
      subscriptionModel.countDocuments({ currency: { $exists: false } }),
      installmentModel.countDocuments({ currency: { $exists: false } }),
    ]);

    if (paymentsCheck + expensesCheck + revenueCheck + subscriptionsCheck + installmentsCheck === 0) {
      console.log('   ✅ All records have currency fields!\n');
    } else {
      console.log(`   ⚠️  Warning: ${paymentsCheck + expensesCheck + revenueCheck + subscriptionsCheck + installmentsCheck} records still missing currency fields\n`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }

  process.exit(0);
}

migrate();
