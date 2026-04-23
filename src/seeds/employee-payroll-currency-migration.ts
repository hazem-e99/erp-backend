/**
 * Employee & Payroll Currency Migration Script
 * 
 * Backfills existing employee and payroll records with currency fields.
 * Sets all existing records to EGP (base currency) with exchange rate 1.0.
 * Calculates base amounts from existing amounts.
 * 
 * Run: npx ts-node src/seeds/employee-payroll-currency-migration.ts
 */

import { connect, connection } from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/erp';
const BASE_CURRENCY = 'EGP';
const BASE_EXCHANGE_RATE = 1;

async function migrate() {
  try {
    await connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }
    
    // 1. Migrate Employees
    console.log('\n📋 Migrating Employees...');
    const employeesCollection = db.collection('employees');
    const employeesResult = await employeesCollection.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: BASE_EXCHANGE_RATE,
        },
      },
    );
    
    // Calculate baseBaseSalary and baseMaxKpi for all employees
    const employees = await employeesCollection.find({}).toArray();
    let employeeUpdates = 0;
    
    for (const emp of employees) {
      const baseSalary = emp.baseSalary || 0;
      const maxKpi = emp.maxKpi || 0;
      const exchangeRate = emp.exchangeRate || 1;
      
      const baseBaseSalary = Math.round(baseSalary * exchangeRate * 100) / 100;
      const baseMaxKpi = Math.round(maxKpi * exchangeRate * 100) / 100;
      
      await employeesCollection.updateOne(
        { _id: emp._id },
        {
          $set: {
            baseBaseSalary,
            baseMaxKpi,
          },
        },
      );
      employeeUpdates++;
    }
    
    console.log(`   ✓ Updated ${employeesResult.modifiedCount} employees with currency fields`);
    console.log(`   ✓ Calculated base amounts for ${employeeUpdates} employees`);

    // 2. Migrate Payrolls
    console.log('\n💰 Migrating Payroll records...');
    const payrollsCollection = db.collection('payrolls');
    const payrollsResult = await payrollsCollection.updateMany(
      { currency: { $exists: false } },
      {
        $set: {
          currency: BASE_CURRENCY,
          exchangeRate: BASE_EXCHANGE_RATE,
        },
      },
    );
    
    // Calculate base amounts for all payrolls
    const payrolls = await payrollsCollection.find({}).toArray();
    let payrollUpdates = 0;
    
    for (const payroll of payrolls) {
      const baseSalary = payroll.baseSalary || 0;
      const bonuses = payroll.bonuses || 0;
      const commissions = payroll.commissions || 0;
      const deductions = payroll.deductions || 0;
      const overtimePay = payroll.overtimePay || 0;
      const maxKpi = payroll.maxKpi || 0;
      const kpiAmount = payroll.kpiAmount || 0;
      const exchangeRate = payroll.exchangeRate || 1;
      
      const baseBaseSalary = Math.round(baseSalary * exchangeRate * 100) / 100;
      const baseBonuses = Math.round(bonuses * exchangeRate * 100) / 100;
      const baseCommissions = Math.round(commissions * exchangeRate * 100) / 100;
      const baseDeductions = Math.round(deductions * exchangeRate * 100) / 100;
      const baseOvertimePay = Math.round(overtimePay * exchangeRate * 100) / 100;
      const baseMaxKpi = Math.round(maxKpi * exchangeRate * 100) / 100;
      const baseKpiAmount = Math.round(kpiAmount * exchangeRate * 100) / 100;
      
      // Recalculate netSalary as sum of base amounts
      const netSalary = Math.round((baseBaseSalary + baseBonuses + baseCommissions + baseOvertimePay - baseDeductions + baseKpiAmount) * 100) / 100;
      
      await payrollsCollection.updateOne(
        { _id: payroll._id },
        {
          $set: {
            baseBaseSalary,
            baseBonuses,
            baseCommissions,
            baseDeductions,
            baseOvertimePay,
            baseMaxKpi,
            baseKpiAmount,
            netSalary,
          },
        },
      );
      payrollUpdates++;
    }
    
    console.log(`   ✓ Updated ${payrollsResult.modifiedCount} payrolls with currency fields`);
    console.log(`   ✓ Calculated base amounts for ${payrollUpdates} payrolls`);

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - Employees migrated: ${employeesResult.modifiedCount}`);
    console.log(`   - Employees with base amounts: ${employeeUpdates}`);
    console.log(`   - Payrolls migrated: ${payrollsResult.modifiedCount}`);
    console.log(`   - Payrolls with base amounts: ${payrollUpdates}`);
    
    await connection.close();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await connection.close();
    process.exit(1);
  }
}

migrate();
