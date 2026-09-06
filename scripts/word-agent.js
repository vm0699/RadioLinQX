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

// ── Watch + upload ────────────────────────────────────────────────────────────

function startWatching(caseId, localPath) {
  // Stop any existing watcher for this case
  stopWatching(caseId);

  let debounce = null;
  const watcher = fs.watch(localPath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      // Wait a bit more to ensure Word has finished writing
      await new Promise(r => setTimeout(r, 800));
      try {
        const buf = fs.readFileSync(localPath);
        if (buf.length < 1000) return; // skip tiny/temp files Word writes during save
        console.log('[agent] File changed (' + buf.length + ' bytes) - uploading to API...');
        const { status } = await postMultipart(
          API_BASE + '/api/cases/' + caseId + '/report/import',
          'report-' + caseId + '.docx',
          buf
        );
        if (status >= 200 && status < 300) {
          console.log('[agent] Saved case ' + caseId + ' successfully!');
        } else {
          console.error('[agent] API returned ' + status);
        }
      } catch (err) {
        console.error('[agent] Upload error:', err.message);
      }
    }, 600);
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
    // Download the docx from the real API
    const { status, body } = await fetchBuffer(API_BASE + '/api/cases/' + caseId + '/report.docx');
    if (status !== 200) {
      res.writeHead(502);
      return res.end('API returned ' + status);
    }

    // Write to Documents\RadioLinQ-Reports (NOT temp — Word shows Save As for temp files)
    const localPath = path.join(WORK_DIR, 'report-' + caseId + '.docx');

    // Close Word if it already has this file open (so it re-opens fresh from our updated docx)
    const filename = path.basename(localPath);
    exec('powershell -command "Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() }"');
    await new Promise(r => setTimeout(r, 800)); // wait for Word to close

    fs.writeFileSync(localPath, body);
    console.log('[agent] Saved to ' + localPath);

    // Open with Word explicitly — more reliable than cmd /c start for .docx files
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
        else console.log('[agent] Word opened via WINWORD.EXE: ' + localPath);
      });
    } else {
      // Fallback: use shell association
      exec('cmd /c start "" "' + localPath + '"', (err) => {
        if (err) console.error('[agent] Failed to open Word:', err.message);
        else console.log('[agent] Word opened via shell: ' + localPath);
      });
    }

    // Start watching for Ctrl+S saves
    startWatching(caseId, localPath);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, localPath, message: 'Word opened. Ctrl+S inside Word auto-saves to RadioLinQ — no Save As dialog.' }));
  } catch (err) {
    console.error('[agent] Open error:', err.message);
    res.writeHead(500);
    res.end(err.message);
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
