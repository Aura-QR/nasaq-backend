import { diskStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import * as fs from 'fs';

/**
 * Identity documents must not be readable by whoever holds a link, as every
 * other upload is. `uploads/` survives deploys, so they live inside it, but in
 * a dot-directory: express.static refuses any path with a dot segment, so
 * `/uploads/.private/...` is a 404 and the files are reachable only through
 * the authenticated `/residency-documents/:id/files/:index`.
 */
export const RESIDENCY_UPLOAD_DIR = './uploads/.private/residency';

export const multerResidencyConfig: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(RESIDENCY_UPLOAD_DIR)) fs.mkdirSync(RESIDENCY_UPLOAD_DIR, { recursive: true });
      cb(null, RESIDENCY_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomBytes(16).toString('hex')}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!/\/(pdf|jpeg|jpg|png|heic|heif|webp)$/.test(file.mimetype)) {
      return cb(new Error('يُقبل PDF أو صورة فقط'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
};
