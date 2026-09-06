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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Origin',
      'Accept',
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'X-Requested-With',
      'Range',
      'DAV',
      'If',
      'Lock-Token',
      'Timeout',
      'Depth',
    ],
    exposedHeaders: ['DAV', 'Lock-Token', 'MS-Author-Via', 'Content-Range'],
  });

  // --- DICOMweb reverse proxy -------------------------------------------------
  // Only mounted when an Orthanc is configured. In the hosted deploy there is
  // no Orthanc and the frontend uses /api/local/* (mode "local") instead.
  const orthancAuth =
    'Basic ' +
    Buffer.from(`${config.orthancUser}:${config.orthancPass}`).toString('base64');

  if (config.orthancEnabled) {
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
  }

  await app.listen(config.port, '0.0.0.0');
  log.log(`API listening on :${config.port}`);
  log.log(
    config.orthancEnabled
      ? `DICOMweb proxied to ${config.orthancUrl}/dicom-web`
      : `no Orthanc configured — serving sample-data in local mode`,
  );
}

bootstrap();
