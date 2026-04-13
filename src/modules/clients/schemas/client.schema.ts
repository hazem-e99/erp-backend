import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClientDocument = Client & Document;

@Schema({ timestamps: true })
export class Client {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ default: null })
  phone: string;

  @Prop({ default: null })
  company: string;

  @Prop({ default: null })
  website: string;

  @Prop({ default: null })
  address: string;

  @Prop({ default: 'lead', enum: ['lead', 'active', 'inactive'] })
  status: string;

  @Prop({ default: null })
  industry: string;

  @Prop({ default: null })
  notes: string;

  @Prop({ default: null })
  contactPerson: string;
}

export const ClientSchema = SchemaFactory.createForClass(Client);
