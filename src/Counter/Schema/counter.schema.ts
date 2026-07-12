import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Counter extends Document {
  @Prop({ required: false, unique: true, default: 'students_counter' })
  name: string;

  @Prop({ required: true, default: 0 })
  count: number;

  @Prop({ required: true })
  year: string; 
}

export const CounterSchema = SchemaFactory.createForClass(Counter);