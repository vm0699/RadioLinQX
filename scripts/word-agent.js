/**
 * RadioLinQ Desktop Word Sync Agent
 * 
 * Runs locally on the doctor's workstation (http://127.0.0.1:4820).
 * Opens reports directly in Microsoft Word and detects when the doctor presses Ctrl+S.
 * Automatically syncs the updated report back to the RadioLinQ server without any prompts!
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let mammoth;
try {
  mammoth = require(path.resolve(__dirname, '../apps/api/node_modules/mammoth'));
} catch (e) {
  try {
    mammoth = require('mammoth');
  } catch (e2) {
    console.error('mammoth package not found. Please run npm install in apps/api');
  }
}

const PORT = 4820;
const WORK_DIR = path.join(os.tmpdir(), 'RadioLinQ-Reports');
if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

// Active editing sessions
const sessions = new Map();

// Headings parser matching RadioLinQ report structure
const HEADINGS = ['clinicalHistory', 'technique', 'findings', 'impression'];
const HEADING_MATCH = {
  clinicalHistory: /^clinical history$/i,
  technique: /^technique$/i,
  findings: /^findings$/i,
  impression: /^impression$/i,
};

function parseReportText(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const out = {};
  let current = null;
  let leftover = [];

  for (const line of lines) {
    const hit = HEADINGS.find((h) => HEADING_MATCH[h].test(line));
    if (hit) {
      current = hit;
      out[hit] = out[hit] ?? '';
      continue;
    }
    if (!line && current == null) continue;
    if (current) out[current] = out[current] ? `${out[current]}\n${line}` : line;
    else leftover.push(line);
  }
  for (const h of HEADINGS) if (out[h]) out[h] = out[h].trim();

  if (leftover.join('').trim() && !current) {
    out.findings = [leftover.join('\n').trim(), out.findings].filter(Boolean).join('\n\n');
  }
  return out;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download: status ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(destPath));
        });
      })
      .on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function sendPatch(apiBase, caseId, reportData) {
  return new Promise((resolve, reject) => {
    try {
      const urlStr = `${apiBase.replace(/\/$/, '')}/api/cases/${caseId}`;
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;
      const body = JSON.stringify({ report: reportData });

      const req = client.request(
        url,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`Server returned status ${res.statusCode}: ${data}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function launchWord(filePath) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', filePath], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    }
    console.log(`[Word Agent] Opened Microsoft Word with: ${filePath}`);
  } catch (err) {
    console.error(`[Word Agent] Failed to launch Word: ${err.message}`);
  }
}

function watchFileForSync(session) {
  if (session.watcher) {
    fs.unwatchFile(session.filePath);
  }

  let debounceTimer = null;
  const onFileChanged = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        if (!fs.existsSync(session.filePath)) return;
        const curStat = fs.statSync(session.filePath);
        if (curStat.mtimeMs <= session.lastMtime) return;
        session.lastMtime = curStat.mtimeMs;

        console.log(`[Word Agent] File modified detected for case ${session.caseNumber}. Reading updated Word doc...`);
        const buffer = fs.readFileSync(session.filePath);
        if (!buffer.length) return;

        let rawText = '';
        if (mammoth) {
          const res = await mammoth.extractRawText({ buffer });
          rawText = res.value;
        }

        const parsedReport = parseReportText(rawText);
        session.lastReport = parsedReport;
        session.lastSyncedAt = new Date().toISOString();

        console.log(`[Word Agent] Auto-syncing to ${session.apiBase}...`);
        await sendPatch(session.apiBase, session.caseId, parsedReport);
        console.log(`[Word Agent] SUCCESS! Report for ${session.caseNumber} synced automatically to server!`);
      } catch (err) {
        console.error(`[Word Agent] Auto-sync error: ${err.message}`);
      }
    }, 400);
  };

  fs.watchFile(session.filePath, { interval: 500 }, onFileChanged);
  session.watcher = true;
}

// HTTP API Server for the Web App to communicate with
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/status')) {
    const sessionList = Array.from(sessions.values()).map((s) => ({
      caseId: s.caseId,
      caseNumber: s.caseNumber,
      filePath: s.filePath,
      lastSyncedAt: s.lastSyncedAt,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: '1.0.0', sessions: sessionList }));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname.startsWith('/session/')) {
    const caseId = parsedUrl.pathname.replace('/session/', '');
    const session = sessions.get(caseId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ active: false }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        active: true,
        caseId: session.caseId,
        caseNumber: session.caseNumber,
        lastSyncedAt: session.lastSyncedAt,
        report: session.lastReport,
      }),
    );
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/open') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { caseId, caseNumber, docxUrl, apiBase } = payload;

        if (!caseId || !docxUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing caseId or docxUrl' }));
          return;
        }

        const safeCaseNo = (caseNumber || caseId).replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${safeCaseNo}-report.docx`;
        const filePath = path.join(WORK_DIR, fileName);

        console.log(`[Word Agent] Downloading report template for ${caseNumber}...`);
        await downloadFile(docxUrl, filePath);
        console.log(`[Word Agent] Report saved locally to ${filePath}`);

        const stat = fs.statSync(filePath);
        const session = {
          caseId,
          caseNumber: caseNumber || caseId,
          filePath,
          apiBase: apiBase || 'https://radiolinq-api.onrender.com',
          lastMtime: stat.mtimeMs,
          startedAt: new Date().toISOString(),
          lastSyncedAt: null,
          lastReport: null,
        };

        sessions.set(caseId, session);
        watchFileForSync(session);
        launchWord(filePath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            message: 'Word launched locally. Auto-sync active on Ctrl+S.',
            filePath,
          }),
        );
      } catch (err) {
        console.error(`[Word Agent] Error in /open:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('====================================================');
  console.log(`RadioLinQ Word Sync Agent running on http://127.0.0.1:${PORT}`);
  console.log(`Monitoring folder: ${WORK_DIR}`);
  console.log('Open any report in RadioLinQ -> Press Ctrl+S in Word to auto-sync!');
  console.log('====================================================');
});
