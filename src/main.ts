import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './filters/http-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Number of reverse proxies in front of this app.
  //
  // This MUST be a number, never `true`. With a number, Express walks
  // X-Forwarded-For from the RIGHT and skips exactly that many trusted hops,
  // so anything a client prepended to the header is ignored and req.ip is the
  // real peer. With `true` the whole chain is trusted and any caller can claim
  // any IP — which would defeat the school-network check in teacher check-in.
  //
  // Set TRUST_PROXY_HOPS to match the real deployment (Coolify/Traefik = 1).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.enableCors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Curl, Postman)
    if (!origin) return callback(null, true);

    const envOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : [];

    const allowedOrigins = [
      'https://nasaq.185.170.196.120.sslip.io',
      'http://nasaq.185.170.196.120.sslip.io',
      'https://api.nasaq.185.170.196.120.sslip.io',
      'http://api.nasaq.185.170.196.120.sslip.io',
      'http://localhost:5000',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:4200',
      ...envOrigins,
    ];

    const isAllowed =
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes('*') ||
      /\.sslip\.io$/.test(new URL(origin).hostname) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('https://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('https://127.0.0.1:');

    if (isAllowed) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-School-Id',
    'x-tenant-id',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
  ],
  exposedHeaders: ['Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
});

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global response interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('Nasaq Multi-Tenant SaaS Platform API')
    .setDescription(
      'API documentation for Nasaq Multi-Tenant SaaS Platform.\n\n' +
        '**Multi-Tenancy Scoping Notice**: `schoolId` is derived server-side from the verified JWT payload and is NEVER accepted as a request body or parameter field on any endpoint.',
    )
    .setVersion('2.0 (Multi-Tenant)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'School User JWT (Owner, Manager, Teacher, Student)',
      },
      'school-jwt',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Platform Super Admin JWT',
      },
      'platform-jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on port ${port}`);
  console.log(`📚 Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();
