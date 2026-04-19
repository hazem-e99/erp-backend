/**
 * Supported currencies in the finance system
 */
export enum SupportedCurrency {
  EGP = 'EGP', // Egyptian Pound (Base Currency)
  USD = 'USD', // US Dollar
  SAR = 'SAR', // Saudi Riyal
  EUR = 'EUR', // Euro
  GBP = 'GBP', // British Pound
  AED = 'AED', // UAE Dirham
}

/**
 * Base currency for all financial calculations and reporting
 * All amounts are converted to this currency for aggregation
 */
export const BASE_CURRENCY = SupportedCurrency.EGP;

/**
 * Currency display names
 */
export const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  [SupportedCurrency.EGP]: 'Egyptian Pound',
  [SupportedCurrency.USD]: 'US Dollar',
  [SupportedCurrency.SAR]: 'Saudi Riyal',
  [SupportedCurrency.EUR]: 'Euro',
  [SupportedCurrency.GBP]: 'British Pound',
  [SupportedCurrency.AED]: 'UAE Dirham',
};

/**
 * Currency symbols
 */
export const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  [SupportedCurrency.EGP]: 'E£',
  [SupportedCurrency.USD]: '$',
  [SupportedCurrency.SAR]: 'SR',
  [SupportedCurrency.EUR]: '€',
  [SupportedCurrency.GBP]: '£',
  [SupportedCurrency.AED]: 'AED',
};
