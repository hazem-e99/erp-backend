import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PayrollConfigDocument = PayrollConfig & Document;

/**
 * Singleton document that holds the payroll cycle configuration.
 * Only one record is stored (found/created by convention – no key field needed).
 *
 * Default cycle:
 *   26th of prev month → 25th of current month
 *   Payment on the 25th of current month
 */
@Schema({ timestamps: true })
export class PayrollConfig {
  /** Day the cycle STARTS (in the previous calendar month). Default: 26 */
  @Prop({ default: 26, min: 1, max: 31 })
  cycleStartDay: number;

  /** Day the cycle ENDS (in the current calendar month). Default: 25 */
  @Prop({ default: 25, min: 1, max: 31 })
  cycleEndDay: number;

  /** Day salaries are paid out (in the current calendar month). Default: 25 */
  @Prop({ default: 25, min: 1, max: 31 })
  paymentDay: number;
}

export const PayrollConfigSchema = SchemaFactory.createForClass(PayrollConfig);
