import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {

        if (data && typeof data === 'object' && 'status' in data) {
          return data;
        }

        // Extract pagination fields if they exist
        const { message, data: responseData, totalDocs , totalPages } = data || {};
        if(totalDocs || totalPages){
        return {
          status: true,
          message: message || 'Success',
          data: responseData || data,
          pagination : {totalDocs, totalPages}
        }
        }
        return{
          status: true,
          message: message || 'Success',
          data: responseData || data,
        }

      }),
    );
  }
}