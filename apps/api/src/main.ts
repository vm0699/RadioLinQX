import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const log = new Logger('bootstrap');

  app.enableCors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'Accept',
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'X-Requested-With',
    ],
  });

  // --- DICOMweb reverse proxy -------------------------------------------------
  // Everything under /dicom-web is streamed straight to Orthanc. Multipart
  // WADO-RS responses pass through untouched. This is the seam where per-user
  // auth / audit logging will live once the dashboard exists.
  const orthancAuth =
    'Basic ' +
    Buffer.from(`${config.orthancUser}:${config.orthancPass}`).toString('base64');

  app.use(
    '/dicom-web',
    createProxyMiddleware({
      target: config.orthancUrl,
      changeOrigin: true,
      pathRewrite: { '^/dicom-web': '/dicom-web' },
      headers: { Authorization: orthancAuth },
      on: {
        proxyRes: (proxyRes) => {
          proxyRes.headers['access-control-allow-origin'] = '*';
        },
        error: (err, _req, res) => {
          log.error(`DICOMweb proxy error: ${err.message}`);
          if ('writeHead' in res && !res.headersSent) {
            (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
          }
          (res as any).end?.('Bad gateway (Orthanc unreachable)');
        },
      },
    }),
  );

  await app.listen(config.port, '0.0.0.0');
  log.log(`API listening on :${config.port}`);
  log.log(`DICOMweb proxied to ${config.orthancUrl}/dicom-web`);
}

bootstrap();
