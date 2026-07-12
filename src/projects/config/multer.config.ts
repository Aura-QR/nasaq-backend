import { diskStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import * as fs from 'fs';

export const multerConfig: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = './uploads/projects/temp';

      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.match(/\/(pdf|jpeg|png|jpg|mp4)$/)) {
      return cb(new Error('Only PDF, JPEG, PNG, and MP4 files are allowed'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
};
