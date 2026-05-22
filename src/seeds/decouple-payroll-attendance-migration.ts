/**
 * Decouple Payroll from Attendance Migration
 *
 * Removes attendance/overtime fields from existing payroll documents and
 * recalculates `netSalary` to exclude `baseOvertimePay`.
 *
 * Affected fields (unset on every payroll):
 *   - overtimePay, baseOvertimePay
 *   - workingDays, presentDays
 *
 * Also cleans up the `breakdown` snapshot to drop:
 *   hourlyRate, presentDays, totalWorkingHours, overtimeHours,
 *   totalLateMinutes, overtimePay
 *
 * Net salary is recalculated as:
 *   (cycleStart != null ? baseProratedBaseSalary : baseBaseSalary)
 *   + baseBonuses + baseCommissions - baseDeductions + baseKpiAmount
 *
 * Run: npx ts-node src/seeds/decouple-payroll-attendance-migration.ts
 */

import { connect, connection } from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/erp';

async function migrate() {
  try {
    await connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = connection.db;
    if (!db) throw new Error('Database connection not established');

    const payrolls = db.collection('payrolls');

    // ── 1. Recalculate netSalary on every payroll (drops overtime contribution) ──
    console.log('\n🔢 Recalculating netSalary for all payrolls...');
    const cursor = payrolls.find({});
    let recalculated = 0;
    let unchanged = 0;

    while (await cursor.hasNext()) {
      const p: any = await cursor.next();
      if (!p) continue;

      const effectiveProratedBase =
        p.cycleStart != null
          ? p.baseProratedBaseSalary ?? 0
          : p.baseBaseSalary ?? 0;

      const newNet = parseFloat(
        (
          effectiveProratedBase +
          (p.baseBonuses ?? 0) +
          (p.baseCommissions ?? 0) -
          (p.baseDeductions ?? 0) +
          (p.baseKpiAmount ?? 0)
        ).toFixed(2),
      );

      // Sync breakdown.netSalary too, and drop stale overtime fields from it.
      const newBreakdown =
        p.breakdown && typeof p.breakdown === 'object'
          ? { ...p.breakdown, netSalary: newNet }
          : p.breakdown;

      if (newBreakdown && typeof newBreakdown === 'object') {
        delete newBreakdown.hourlyRate;
        delete newBreakdown.presentDays;
        delete newBreakdown.totalWorkingHours;
        delete newBreakdown.overtimeHours;
        delete newBreakdown.totalLateMinutes;
        delete newBreakdown.overtimePay;
      }

      if (
        p.netSalary === newNet &&
        JSON.stringify(p.breakdown) === JSON.stringify(newBreakdown)
      ) {
        unchanged++;
        continue;
      }

      await payrolls.updateOne(
        { _id: p._id },
        { $set: { netSalary: newNet, breakdown: newBreakdown } },
      );
      recalculated++;
    }
    console.log(
      `   ↪ recalculated ${recalculated}, unchanged ${unchanged}`,
    );

    // ── 2. Unset the deprecated fields ──
    console.log('\n🧹 Unsetting deprecated overtime/attendance fields...');
    const unsetResult = await payrolls.updateMany(
      {
        $or: [
          { overtimePay: { $exists: true } },
          { baseOvertimePay: { $exists: true } },
          { workingDays: { $exists: true } },
          { presentDays: { $exists: true } },
        ],
      },
      {
        $unset: {
          overtimePay: '',
          baseOvertimePay: '',
          workingDays: '',
          presentDays: '',
        },
      },
    );
    console.log(`   ↪ cleaned ${unsetResult.modifiedCount} payroll(s)`);

    console.log('\n✅ Migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

migrate();
