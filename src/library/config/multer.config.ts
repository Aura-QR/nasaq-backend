import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { randomUUID } from 'crypto';

const extensions = new Set([
  '.pdf',
  '.ppt',
  '.pptx',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.mp4',
  '.mp3',
]);
export const libraryMulterConfig: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync('./uploads/library', { recursive: true });
      cb(null, './uploads/library');
    },
    filename: (_req, file, cb) =>
      cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!extensions.has(extname(file.originalname).toLowerCase()))
      return cb(new BadRequestException('نوع الملف غير مدعوم'), false);
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
};
