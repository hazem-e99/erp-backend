import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContractTypeDocument = ContractType & Document;

@Schema({ timestamps: true })
export class ContractType {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ default: null })
  description: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const ContractTypeSchema = SchemaFactory.createForClass(ContractType);
