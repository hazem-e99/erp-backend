import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true })
  clientId: Types.ObjectId;

  @Prop({ default: 'planning', enum: ['planning', 'in-progress', 'on-hold', 'completed', 'cancelled'] })
  status: string;

  @Prop({ default: 'medium', enum: ['low', 'medium', 'high', 'critical'] })
  priority: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  deadline: Date;

  @Prop({ default: 0 })
  budget: number;

  @Prop({ default: 0 })
  spent: number;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Employee' }], default: [] })
  teamMembers: Types.ObjectId[];

  @Prop({ default: null })
  managerId: Types.ObjectId;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
