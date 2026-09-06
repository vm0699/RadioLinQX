/**
 * RadioLinQ Word Sync Agent - Local WebDAV Proxy
 *
 * How it works:
 *   1. Frontend fires: ms-word:ofe|u|http://127.0.0.1:4820/report/CASE_ID
 *   2. Word does OPTIONS -> GET -> LOCK -> (user edits) -> PUT -> UNLOCK to localhost:4820
 *   3. This agent proxies GET from the real API and PUT back to the real API import endpoint.
 *   4. Ctrl+S in Word saves directly to RadioLinQ with NO Save As dialog.
 *
 * Run this ONCE before clicking "Open in Word":
 *   node scripts/word-agent.js
 *   (or double-click start-word-sync.bat)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 4820;
const API_BASE = 'https://radiolinq-api.onrender.com';

// Map caseId -> lock token
const locks = new Map();

function genToken() {
  return 'urn:uuid:' + Math.random().toString(36).slice(2) + '-' + Date.now();
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'RadioLinQ-WordAgent/1.0' }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function postMultipart(url, filename, buf) {
  return new Promise((resolve, reject) => {
    const boundary = '----RadioLinQBoundary' + Date.now();
    const header = Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'
    );
    const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([header, buf, footer]);

    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length,
          'User-Agent': 'RadioLinQ-WordAgent/1.0',
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          console.log('[agent] import -> ' + res.statusCode + ' ' + text.slice(0, 120));
          resolve({ status: res.statusCode, body: text });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseCaseId(pathname) {
  const m = pathname.match(/^\/report\/([^/]+)/);
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  const method = req.method.toUpperCase();
  const { pathname } = new URL(req.url, 'http://localhost:' + PORT);

  console.log('[agent] ' + method + ' ' + pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS,LOCK,UNLOCK,PROPFIND,HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Depth,Timeout,Lock-Token,If');
  res.setHeader('DAV', '1,2');
  res.setHeader('MS-Author-Via', 'DAV');

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,HEAD,PUT,OPTIONS,LOCK,UNLOCK,PROPFIND');
    res.writeHead(200);
    return res.end();
  }

  const caseId = parseCaseId(pathname);
  if (!caseId) {
    res.writeHead(404);
    return res.end('Not found');
  }

  // HEAD / GET - serve the docx from the real API
  if (method === 'HEAD' || method === 'GET') {
    try {
      const { status, body } = await fetchBuffer(API_BASE + '/api/cases/' + caseId + '/report.docx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Length', body.length);
      res.setHeader('Content-Disposition', 'inline; filename="report-' + caseId + '.docx"');
      res.setHeader('ETag', '"' + caseId + '-' + Date.now() + '"');
      res.setHeader('Last-Modified', new Date().toUTCString());
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.writeHead(status === 200 ? 200 : status);
      return res.end(method === 'HEAD' ? undefined : body);
    } catch (err) {
      console.error('[agent] GET error', err.message);
      res.writeHead(502);
      return res.end('Bad gateway');
    }
  }

  // PROPFIND - minimal WebDAV response
  if (method === 'PROPFIND') {
    const xml = '<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n  <D:response>\n    <D:href>http://127.0.0.1:' + PORT + pathname + '</D:href>\n    <D:propstat>\n      <D:prop>\n        <D:resourcetype/>\n        <D:getcontenttype>application/vnd.openxmlformats-officedocument.wordprocessingml.document</D:getcontenttype>\n        <D:getlastmodified>' + new Date().toUTCString() + '</D:getlastmodified>\n        <D:supportedlock>\n          <D:lockentry>\n            <D:lockscope><D:exclusive/></D:lockscope>\n            <D:locktype><D:write/></D:locktype>\n          </D:lockentry>\n        </D:supportedlock>\n      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n</D:multistatus>';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.writeHead(207);
    return res.end(xml);
  }

  // LOCK - return a fake lock token so Word proceeds
  if (method === 'LOCK') {
    const token = locks.get(caseId) || genToken();
    locks.set(caseId, token);
    const xml = '<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:">\n  <D:lockdiscovery>\n    <D:activelock>\n      <D:locktype><D:write/></D:locktype>\n      <D:lockscope><D:exclusive/></D:lockscope>\n      <D:depth>0</D:depth>\n      <D:timeout>Second-3600</D:timeout>\n      <D:locktoken><D:href>' + token + '</D:href></D:locktoken>\n      <D:lockroot><D:href>http://127.0.0.1:' + PORT + pathname + '</D:href></D:lockroot>\n    </D:activelock>\n  </D:lockdiscovery>\n</D:prop>';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Lock-Token', '<' + token + '>');
    res.writeHead(200);
    return res.end(xml);
  }

  // UNLOCK - clear lock
  if (method === 'UNLOCK') {
    locks.delete(caseId);
    res.writeHead(204);
    return res.end();
  }

  // PUT - Word is saving; forward to the RadioLinQ import endpoint
  if (method === 'PUT') {
    try {
      const buf = await readBody(req);
      console.log('[agent] PUT ' + caseId + ' - received ' + buf.length + ' bytes, uploading to API...');
      const { status } = await postMultipart(
        API_BASE + '/api/cases/' + caseId + '/report/import',
        'report-' + caseId + '.docx',
        buf
      );
      if (status >= 200 && status < 300) {
        console.log('[agent] Saved case ' + caseId + ' successfully');
        res.writeHead(204);
      } else {
        console.error('[agent] API returned ' + status);
        res.writeHead(502);
      }
    } catch (err) {
      console.error('[agent] PUT error', err.message);
      res.writeHead(500);
    }
    return res.end();
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('+------------------------------------------------------+');
  console.log('¦   RadioLinQ Word Sync Agent  *  localhost:' + PORT + '       ¦');
  console.log('¦------------------------------------------------------¦');
  console.log('¦  1. Click "Open in Word" in the web app              ¦');
  console.log('¦  2. Edit the report in Word                          ¦');
  console.log('¦  3. Press Ctrl+S -> saves directly to RadioLinQ!     ¦');
  console.log('¦     No "Save As" dialog. No extra steps.             ¦');
  console.log('+------------------------------------------------------+');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[agent] Port ' + PORT + ' already in use - agent may already be running.');
  } else {
    console.error('[agent] Server error:', err.message);
  }
  process.exit(1);
});
