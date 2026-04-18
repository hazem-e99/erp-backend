import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

// ─── Shared numeric utilities ──────────────────────────────────────────────

/** Round to 2 decimal places using banker-safe integer math */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Returns true if `value`, when rounded to 2 decimal places, is within
 * floating-point epsilon of the original value.
 * Accepts values like 0.30000000000000004 (JS float artefact of 0.30).
 */
export function hasTwoDecimalsOrLess(value: number): boolean {
  if (!isFinite(value) || isNaN(value)) return false;
  return Math.abs(roundCents(value) - value) < 1e-9;
}

// ─── @IsFinancialAmount decorator ─────────────────────────────────────────

/**
 * Composite validator for all financial amount fields.
 * Asserts:
 *   - finite number (not NaN / Infinity)
 *   - > 0
 *   - ≤ max (default 1,000,000)
 *   - at most 2 decimal places
 *
 * Usage:
 *   @IsFinancialAmount()           → max 1,000,000
 *   @IsFinancialAmount(500_000)    → max 500,000
 */
export function IsFinancialAmount(
  max = 1_000_000,
  validationOptions?: ValidationOptions,
) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: 'isFinancialAmount',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments): boolean {
          if (typeof value !== 'number') return false;
          if (!isFinite(value) || isNaN(value)) return false;
          if (value <= 0) return false;
          if (value > args.constraints[0]) return false;
          return hasTwoDecimalsOrLess(value);
        },
        defaultMessage(args: ValidationArguments): string {
          const maxVal = args.constraints[0] as number;
          const v = args.value;
          if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) {
            return `${args.property} must be a valid finite number`;
          }
          if (v <= 0) return `${args.property} must be greater than 0`;
          if (v > maxVal) return `${args.property} cannot exceed ${maxVal.toLocaleString()}`;
          return `${args.property} must have at most 2 decimal places`;
        },
      },
    });
  };
}
