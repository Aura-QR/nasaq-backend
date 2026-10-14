import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

export const ANNOUNCEMENT_UPLOAD_DIR = './uploads/announcements';
export const ANNOUNCEMENT_UPLOAD_PREFIX = '/uploads/announcements/';

/**
 * Images only, by extension and MIME type together.
 *
 * No video: a clip is a link to YouTube or the like. Served from here, every
 * home screen that opens a slide would stream it from this server — fifty
 * megabytes times every student — where YouTube streams it at the quality each
 * phone's connection can take.
 *
 * No SVG: everything under /uploads is served as-is to anyone with the link,
 * and an SVG is a document that can run script.
 */
export const ANNOUNCEMENT_IMAGE_TYPES: Record<string, RegExp> = {
  '.jpg': /^image\/jpe?g$/,
  '.jpeg': /^image\/jpe?g$/,
  '.png': /^image\/png$/,
  '.webp': /^image\/webp$/,
};

/** A banner image, not a print-quality photo. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Each school's files in a folder of its own, so a slide can only ever point
 * at its own school's files and deleting one never breaks another school's.
 * The id is from the signed token, and checked anyway: it becomes a path.
 */
export function schoolFolderOf(user: any): string {
  const schoolId = String(user?.schoolId ?? '');
  if (!/^[a-f0-9]{24}$/.test(schoolId)) throw new BadRequestException('لا توجد مدرسة لهذا الحساب');
  return schoolId;
}

export const announcementMulterConfig: MulterOptions = {
  storage: diskStorage({
    destination: (req: any, _file, cb) => {
      try {
        const dir = join(ANNOUNCEMENT_UPLOAD_DIR, schoolFolderOf(req.user));
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error as Error, '');
      }
    },
    // Never the uploaded name: two admins both sending `banner.png` must not
    // overwrite each other's slide.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (_req, file, cb) => {
    const mime = ANNOUNCEMENT_IMAGE_TYPES[extname(file.originalname).toLowerCase()];
    if (!mime || !mime.test(file.mimetype)) {
      const message = file.mimetype.startsWith('video/')
        ? 'لا يُرفع الفيديو على المنصة — ارفعه على يوتيوب وضع رابطه في الإعلان'
        : 'يُقبل صورة JPG أو PNG أو WEBP فقط';
      return cb(new BadRequestException(message), false);
    }
    cb(null, true);
  },
  // Refused while it streams in, so an oversized file never lands on disk.
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
};
