import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  healthCheck(): string {
    return 'Server is running';
  }

  testApi() {
    return {
      status: 'success',
      massage: 'API is working',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}
