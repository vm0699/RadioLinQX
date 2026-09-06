/**
 * RadioLinQ Word Sync Agent
 *
 * Flow:
 *   Browser calls GET http://127.0.0.1:4820/open/CASE_ID
 *   Agent downloads the docx from the API to a local temp file
 *   Agent opens Word with that local file  (cmd /c start "" "path\to\report.docx")
 *   Agent watches the file for changes (fs.watch + debounce)
 *   When you press Ctrl+S in Word, it saves locally (NO Save As dialog)
 *   Agent detects the save and auto-uploads to radiolinq-api.onrender.com
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { URL } = require('url');

const PORT = 4820;
const API_BASE = 'https://radiolinq-api.onrender.com';

// Use Documents folder — NOT system temp (AppData\Local\Temp causes Save As dialog in Word)
const WORK_DIR = path.join(os.homedir(), 'Documents', 'RadioLinQ-Reports');
if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

// caseId -> { watcher, debounce, localPath }
const sessions = new Map();

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'RadioLinQ-Agent/2.0' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function postMultipart(url, filename, buf) {
  return new Promise((resolve, reject) => {
    const boundary = '----RadioLinQBoundary' + Date.now();
    const header = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'
    );
    const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([header, buf, footer]);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        'User-Agent': 'RadioLinQ-Agent/2.0',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Safe file reading with retry on EBUSY ────────────────────────────────────

async function readFileWithRetry(filePath, maxRetries = 6, delayMs = 300) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fs.readFileSync(filePath);
    } catch (e) {
      if ((e.code === 'EBUSY' || e.code === 'EPERM') && i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
}

// ── Watch + upload ────────────────────────────────────────────────────────────

function startWatching(caseId, localPath) {
  stopWatching(caseId);

  let debounce = null;
  let isUploading = false;
  let lastHash = '';

  const watcher = fs.watch(localPath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (isUploading) return;
      isUploading = true;
      try {
        // Give Word a brief moment to finish flushing its disk write
        await new Promise((r) => setTimeout(r, 600));
        const buf = await readFileWithRetry(localPath);
        if (buf.length < 1000) return; // ignore temp/partial files

        console.log('[agent] File saved by Word (' + buf.length + ' bytes) — uploading to RadioLinQ...');
        const { status, body } = await postMultipart(
          API_BASE + '/api/cases/' + caseId + '/report/import',
          'report-' + caseId + '.docx',
          buf
        );
        if (status >= 200 && status < 300) {
          console.log('[agent] ✅ Case ' + caseId + ' auto-saved successfully!');
        } else {
          console.error('[agent] ⚠️ Upload returned ' + status + ':', body.slice(0, 100));
        }
      } catch (err) {
        console.error('[agent] Auto-save error:', err.message);
      } finally {
        isUploading = false;
      }
    }, 500);
  });

  sessions.set(caseId, { watcher, localPath });
  console.log('[agent] Watching ' + localPath);
}

function stopWatching(caseId) {
  const s = sessions.get(caseId);
  if (s) {
    try { s.watcher.close(); } catch {}
    sessions.delete(caseId);
  }
}

// ── Open/download handler ─────────────────────────────────────────────────────

async function handleOpen(caseId, res) {
  console.log('[agent] Opening case ' + caseId + ' in Word...');
  try {
    const localPath = path.join(WORK_DIR, 'report-' + caseId + '.docx');

    // Check if the file is already open / locked by Word
    let isLocked = false;
    if (fs.existsSync(localPath)) {
      try {
        const fd = fs.openSync(localPath, 'r+');
        fs.closeSync(fd);
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          isLocked = true;
        }
      }
    }

    if (!isLocked) {
      try {
        const { status, body } = await fetchBuffer(API_BASE + '/api/cases/' + caseId + '/report.docx');
        if (status === 200 && body && body.length > 0) {
          fs.writeFileSync(localPath, body);
          try { fs.chmodSync(localPath, 0o666); } catch {}
          exec('attrib -r "' + localPath + '"');
          exec('powershell -command "Unblock-File -Path \'' + localPath + '\'"');
          console.log('[agent] Saved + unblocked: ' + localPath);
        }
      } catch (dlErr) {
        console.warn('[agent] Download warning:', dlErr.message);
      }
    } else {
      console.log('[agent] Document already open in Word, retaining current open file');
    }

    // Launch Word explicitly via WINWORD.EXE if available
    const wordPaths = [
      'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
      'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
      'C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE',
    ];
    let wordExe = null;
    for (const wp of wordPaths) {
      if (fs.existsSync(wp)) { wordExe = wp; break; }
    }

    if (wordExe) {
      exec('"' + wordExe + '" "' + localPath + '"', (err) => {
        if (err) console.error('[agent] WINWORD.EXE error:', err.message);
        else console.log('[agent] Word launched via WINWORD.EXE: ' + localPath);
      });
    } else {
      exec('cmd /c start "" "' + localPath + '"', (err) => {
        if (err) console.error('[agent] Shell open error:', err.message);
        else console.log('[agent] Word launched via shell: ' + localPath);
      });
    }

    // Start watching for Ctrl+S
    startWatching(caseId, localPath);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      localPath,
      message: 'Word opened. Ctrl+S inside Word auto-saves to RadioLinQ — no Save As dialog.',
    }));
  } catch (err) {
    console.error('[agent] Open error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const method = req.method.toUpperCase();
  const { pathname } = new URL(req.url, 'http://localhost:' + PORT);

  console.log('[agent] ' + method + ' ' + pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
  }

  const openMatch = pathname.match(/^\/open\/([^/]+)$/);
  if (openMatch && method === 'GET') {
    return handleOpen(openMatch[1], res);
  }

  const stopMatch = pathname.match(/^\/stop\/([^/]+)$/);
  if (stopMatch && method === 'GET') {
    stopWatching(stopMatch[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('+======================================================+');
  console.log('|   RadioLinQ Word Sync Agent  *  localhost:' + PORT + '       |');
  console.log('+======================================================+');
  console.log('|  Keep this window OPEN while using Word.             |');
  console.log('|  Click "Open in Word" in the site.                   |');
  console.log('|  Press Ctrl+S in Word -> auto-saves to RadioLinQ!    |');
  console.log('|  No "Save As" dialog. No extra steps.                |');
  console.log('+======================================================+');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[agent] Port ' + PORT + ' already in use - kill it and retry.');
  } else {
    console.error('[agent] Server error:', err.message);
  }
  process.exit(1);
});
