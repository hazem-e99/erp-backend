import { BadRequestException, NotFoundException } from '@nestjs/common';

interface FinanceErrorOptions {
  code: string;
  field?: string;
}

export class FinanceException extends BadRequestException {
  constructor(message: string, options: FinanceErrorOptions) {
    super({ message, code: options.code, field: options.field });
  }
}

export class FinanceNotFoundException extends NotFoundException {
  constructor(message: string, code: string) {
    super({ message, code });
  }
}

// ─── Pre-defined errors ────────────────────────────────────────────────────

export const FinanceErrors = {
  // Subscription
  SUBSCRIPTION_NOT_FOUND: () =>
    new FinanceNotFoundException('Subscription not found', 'SUBSCRIPTION_NOT_FOUND'),
  SUBSCRIPTION_ALREADY_CANCELLED: () =>
    new FinanceException('This subscription is already cancelled', { code: 'SUBSCRIPTION_ALREADY_CANCELLED' }),
  SUBSCRIPTION_COMPLETED_CANCEL: () =>
    new FinanceException('A completed subscription cannot be cancelled', { code: 'SUBSCRIPTION_COMPLETED_CANCEL' }),
  SUBSCRIPTION_INVALID_TOTAL: () =>
    new FinanceException('Total price must be greater than 0', { code: 'INVALID_TOTAL_PRICE', field: 'totalPrice' }),
  SUBSCRIPTION_MISSING_ITEMS: () =>
    new FinanceException('installmentItems is required for this payment plan', { code: 'MISSING_INSTALLMENT_ITEMS', field: 'installmentItems' }),
  SUBSCRIPTION_SPLIT2_REQUIRES_2: () =>
    new FinanceException('Split payment plan requires exactly 2 installment items', { code: 'SPLIT2_REQUIRES_2_ITEMS', field: 'installmentItems' }),

  // Installment
  INSTALLMENT_NOT_FOUND: () =>
    new FinanceNotFoundException('Installment not found', 'INSTALLMENT_NOT_FOUND'),
  INSTALLMENT_ALREADY_PAID: () =>
    new FinanceException('This installment is already fully paid', { code: 'INSTALLMENT_ALREADY_PAID', field: 'installmentId' }),
  INSTALLMENT_CANCELLED_SUB: () =>
    new FinanceException('Cannot pay an installment for a cancelled subscription', { code: 'INSTALLMENT_CANCELLED_SUBSCRIPTION' }),

  // Payment
  PAYMENT_AMOUNT_ZERO: () =>
    new FinanceException('Payment amount must be greater than 0', { code: 'PAYMENT_AMOUNT_ZERO', field: 'amount' }),
  PAYMENT_CONFLICT: () =>
    new FinanceException('Payment conflict: this installment was updated concurrently. Please try again.', { code: 'PAYMENT_CONCURRENT_CONFLICT' }),

  // Expense
  EXPENSE_INVALID_AMOUNT: () =>
    new FinanceException('Expense amount must be greater than 0', { code: 'EXPENSE_INVALID_AMOUNT', field: 'amount' }),
  EXPENSE_INVALID_FILE: () =>
    new FinanceException('Only JPEG, PNG, WebP and PDF files up to 5 MB are allowed', { code: 'EXPENSE_INVALID_FILE', field: 'attachment' }),
} as const;
