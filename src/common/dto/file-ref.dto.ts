import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
export class FileRefDto {
  @IsString() @IsNotEmpty() filename: string;
  @IsString() @IsNotEmpty() originalName: string;
  @IsString() @IsNotEmpty() path: string;
  @IsInt() @Min(0) size: number;
}
export const FILE_REF = {
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number, required: true, min: 0 },
};
