/**
 * Payroll Cycle Utilities
 *
 * Cycle definition (default):
 *   cycleStartDay = 26 → starts on the 26th of the PREVIOUS month
 *   cycleEndDay   = 25 → ends   on the 25th of the CURRENT month
 *   paymentDay    = 25 → salaries paid on the 25th of the CURRENT month
 *
 * "Payroll month" M/Y represents the cycle ENDING in month M, year Y.
 *
 * Example: month=5, year=2026
 *   cycleStart  = 2026-04-26
 *   cycleEnd    = 2026-05-25
 *   paymentDate = 2026-05-25
 *
 * Salary is always divided by 30 (regardless of actual days in month).
 */

export const SALARY_DAYS_PER_MONTH = 30;

export interface CycleDates {
  cycleStart: Date;
  cycleEnd: Date;
  paymentDate: Date;
  totalCycleDays: number;
}

/**
 * Compute cycle start / end / payment dates from payroll month+year + config.
 */
export function calculateCycleDates(
  month: number,
  year: number,
  cycleStartDay: number,
  cycleEndDay: number,
  paymentDay: number,
): CycleDates {
  // cycleStart = cycleStartDay of the PREVIOUS month
  let startMonth = month - 1;
  let startYear = year;
  if (startMonth === 0) {
    startMonth = 12;
    startYear = year - 1;
  }

  const cycleStart = new Date(
    Date.UTC(startYear, startMonth - 1, cycleStartDay),
  );
  const cycleEnd = new Date(
    Date.UTC(year, month - 1, cycleEndDay, 23, 59, 59, 999),
  );
  const paymentDate = new Date(Date.UTC(year, month - 1, paymentDay));

  // Total calendar days in cycle, inclusive
  const totalCycleDays =
    Math.round(
      (new Date(Date.UTC(year, month - 1, cycleEndDay)).getTime() -
        cycleStart.getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1;

  return { cycleStart, cycleEnd, paymentDate, totalCycleDays };
}

/**
 * Calculate how many "salary days" (out of 30) the employee was active.
 *
 * Rules:
 *   effectiveStart = MAX(cycleStart, dateOfJoining)
 *   effectiveEnd   = MIN(cycleEnd,   lastWorkingDay)   ← null means still active
 *   workedDays     = (calendarDays / totalCalendarCycleDays) * 30   capped at 30
 */
export function calculateWorkedDays(
  cycleStart: Date,
  cycleEnd: Date,
  dateOfJoining: Date,
  lastWorkingDay: Date | null,
): {
  workedDays: number;
  isProrated: boolean;
  effectiveStart: Date;
  effectiveEnd: Date;
} {
  const toUTCDate = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  const csDate = toUTCDate(cycleStart);
  const ceDate = toUTCDate(cycleEnd);
  const joinDate = toUTCDate(dateOfJoining);

  // effectiveStart = max(cycleStart, joiningDate)
  const effectiveStart = joinDate > csDate ? joinDate : csDate;

  // effectiveEnd = min(cycleEnd, lastWorkingDay)
  let effectiveEnd = ceDate;
  if (lastWorkingDay) {
    const lwdDate = toUTCDate(lastWorkingDay);
    if (lwdDate < ceDate) {
      effectiveEnd = lwdDate;
    }
  }

  // Employee entirely outside the cycle
  if (effectiveStart > effectiveEnd) {
    return { workedDays: 0, isProrated: true, effectiveStart, effectiveEnd };
  }

  const calendarWorked =
    Math.round(
      (effectiveEnd.getTime() - effectiveStart.getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1;

  const fullCalendarDays =
    Math.round((ceDate.getTime() - csDate.getTime()) / (1000 * 60 * 60 * 24)) +
    1;

  // Scale to 30-day month, cap at 30
  const workedDays = Math.min(
    SALARY_DAYS_PER_MONTH,
    parseFloat(
      ((calendarWorked / fullCalendarDays) * SALARY_DAYS_PER_MONTH).toFixed(4),
    ),
  );

  const isProrated = calendarWorked < fullCalendarDays;

  return { workedDays, isProrated, effectiveStart, effectiveEnd };
}
