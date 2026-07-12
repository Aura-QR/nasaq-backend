import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'خطأ داخلي في الخادم';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

     
      if (typeof exceptionResponse === 'object' && exceptionResponse['message']) {
        const messages = exceptionResponse['message'];
        

        if (Array.isArray(messages)) {
          message = messages[0]; 
        } else {
          message = messages;
        }
      } else {
        message = exceptionResponse as string;
      }
    } else {
      message = exception.message || 'خطأ داخلي في الخادم';
    }

 
    response.status(status).json({
      status: false,
      message: message,
      statusCode: status,
    });
  }
}