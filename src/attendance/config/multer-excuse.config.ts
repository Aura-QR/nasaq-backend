import { diskStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import * as fs from 'fs';

/**
 * Medical notes attached to an absence excuse.
 *
 * The filename is generated, never the uploaded one. A parent's phone offers
 * whatever the camera named the photo, two families send `IMG_0001.jpg` on the
 * same morning, and the second quietly overwrites the first — which is how a
 * child ends up holding someone else's medical note.
 */
export const multerExcuseConfig: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const path = './uploads/absence-excuses';
      if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
      cb(null, path);
    },
    filename: (_req, file, cb) => {
      const safe = randomBytes(12).toString('hex');
      cb(null, `${Date.now()}-${safe}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!/\/(pdf|jpeg|jpg|png|heic|webp)$/.test(file.mimetype)) {
      return cb(new Error('يُقبل PDF أو صورة فقط'), false);
    }
    cb(null, true);
  },
  // A phone photo of a prescription, not a scan of a hospital file.
  limits: { fileSize: 10 * 1024 * 1024 },
};
