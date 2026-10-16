import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { portFor } from '@synergy/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The web app and the API share one origin behind the suite gateway: the API lives under /api.
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Synergy Books API')
    .setDescription('Double-entry accounting for the Synergy suite')
    .setVersion('0.1')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  // Serve the built web app (apps/books/web/dist) and let its router handle deep links.
  const web = process.env.BOOKS_WEB_DIST || join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(join(web, 'index.html'))) {
    app.useStaticAssets(web, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(web, 'index.html'));
    });
  }

  const port = portFor('books');
  await app.listen(port);
  console.log(`Synergy Books listening on ${port}`);
}

bootstrap();
