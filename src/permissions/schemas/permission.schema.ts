import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Permission extends Document {
  @Prop({ required: true, unique: true, enum: ['ADMIN', 'TEACHER', 'STUDENT'] })
  role: string;

  @Prop({
    type: Object,
    required: true,
    default: {},
  })
  permissions: {
    students: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    teachers: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    classes: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    subjects: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    lectures: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    library: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    attendance: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    gradesCriteria: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    exams: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    projects: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    grades: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    preparation: { read: boolean; add: boolean; edit: boolean; delete: boolean };
    financial: { read: boolean; add: boolean; edit: boolean; delete: boolean };
  };
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);
