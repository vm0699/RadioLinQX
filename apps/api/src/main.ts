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

  // Support Microsoft Word WebDAV protocols (LOCK, UNLOCK, PROPFIND, OPTIONS)
  app.use((req: any, res: any, next: any) => {
    if (req.path && req.path.endsWith('/report.docx')) {
      res.setHeader('DAV', '1, 2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader('Allow', 'GET, HEAD, POST, PUT, OPTIONS, LOCK, UNLOCK, PROPFIND');

      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }
      if (req.method === 'LOCK') {
        const token = `urn:uuid:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        res.setHeader('Content-Type', 'application/xml; charset="utf-8"');
        res.setHeader('Lock-Token', `<${token}>`);
        res.status(200).send(`<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${token}</D:href></D:locktoken>
      <D:lockroot><D:href>${req.path}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`);
        return;
      }
      if (req.method === 'UNLOCK') {
        res.status(204).end();
        return;
      }
      if (req.method === 'PROPFIND') {
        res.setHeader('Content-Type', 'application/xml; charset="utf-8"');
        res.status(207).send(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${req.path}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
        return;
      }
    }
    next();
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
