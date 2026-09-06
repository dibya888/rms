import dotenv from 'dotenv';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const csrfCookie = 'rms_csrf';
import { AppModule } from './app.module';

async function bootstrap() {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const app = await NestFactory.create(AppModule);

  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.use(helmet());
  app.use(cookieParser());

  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id')?.trim() || randomUUID();
    response.setHeader('x-request-id', requestId);
    (request as Request & { requestId: string }).requestId = requestId;
    next();
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const existing = request.cookies?.[csrfCookie];
    const token = existing ?? randomBytes(32).toString('hex');

    if (!request.cookies) request.cookies = {};
    request.cookies[csrfCookie] = token;

    if (!existing) {
      response.cookie(csrfCookie, token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        path: '/',
      });
    }

    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/auth/csrf') return next();

    const provided = request.header('x-csrf-token');
    const origin = request.header('origin');
    const headerOnlyOriginAllowed = !existing && !!origin && allowedOrigins.includes(origin);
    const expectedToken = existing ?? (headerOnlyOriginAllowed ? provided : undefined);

    if (!provided || !expectedToken || provided.length !== expectedToken.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken))) {
      return response.status(403).json({ message: 'CSRF token is missing or invalid' });
    }

    return next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const openApiConfig = new DocumentBuilder()
    .setTitle('RMS API')
    .setDescription('Property and rent management API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApiConfig));

  await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();