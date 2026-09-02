import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Health check endpoint
  @Public()
  @Get(['health-check', 'api/v1/health-check'])
  @ApiOperation({
    summary: 'Health, and which build is actually running',
    description:
      'startedAt dates the running process, so comparing it against the time ' +
      'of a push says whether that push is live yet.',
  })
  @ApiResponse({ status: 200, description: 'Server is healthy' })
  healthCheck() {
    return this.appService.healthCheck();
  }

  // Test endpoint api/v1/test
  @Public()
  @Get(['test', 'api/v1/test'])
  @ApiOperation({ summary: 'Test endpoint to verify API functionality' })
  @ApiResponse({ status: 200, description: 'API is working' })
  test() {
    return this.appService.testApi();
  }
}
