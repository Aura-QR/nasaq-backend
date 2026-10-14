import { ArgumentsHost, Catch, PayloadTooLargeException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../filters/http-exception.filter';
import { MAX_IMAGE_BYTES } from './multer.config';

/**
 * Multer refuses a file over the limit before the handler runs, and says so in
 * English ("File too large"). Same 413 and the same envelope, in Arabic.
 */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter extends GlobalExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const mb = MAX_IMAGE_BYTES / (1024 * 1024);
    super.catch(new PayloadTooLargeException(`حجم الصورة يجب ألا يتجاوز ${mb} ميجابايت`), host);
  }
}
