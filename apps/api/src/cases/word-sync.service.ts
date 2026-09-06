import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import mammoth from 'mammoth';
import { CasesService } from './cases.service';
import { SettingsService } from '../settings/settings.service';
import { buildReportDocx, parseReportText } from './report-docx';

export interface WordSession {
  caseId: string;
  filePath: string;
  startedAt: string;
  lastSavedAt?: string;
  lastMtime: number;
  watcher?: fs.FSWatcher;
  pollTimer?: NodeJS.Timeout;
}

@Injectable()
export class WordSyncService {
  private readonly log = new Logger(WordSyncService.name);
  private sessions = new Map<string, WordSession>();
  private readonly workDir = path.join(os.tmpdir(), 'RadioLinQ-Reports');

  constructor(
    private readonly cases: CasesService,
    private readonly settings: SettingsService,
  ) {
    if (!fs.existsSync(this.workDir)) {
      try {
        fs.mkdirSync(this.workDir, { recursive: true });
      } catch (err: any) {
        this.log.error(`Failed to create work directory: ${err.message}`);
      }
    }
  }

  getSessionStatus(caseId: string) {
    const s = this.sessions.get(caseId);
    if (!s) return { active: false };
    return {
      active: true,
      filePath: s.filePath,
      startedAt: s.startedAt,
      lastSavedAt: s.lastSavedAt,
    };
  }

  async openInWord(caseId: string) {
    const c = await this.cases.get(caseId);
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);

    const appSettings = await this.settings.get();
    const docxBuf = await buildReportDocx(c, appSettings);

    // Clean filename safe for Windows filesystem
    const safeCaseNo = (c.caseNumber || caseId).replace(/[/\\?%*:|"<>]/g, '-');
    const fileName = `${safeCaseNo}-report.docx`;
    const filePath = path.join(this.workDir, fileName);

    // Write the document
    fs.writeFileSync(filePath, docxBuf);
    const stat = fs.statSync(filePath);

    // Clear any previous session for this case
    this.cleanupSession(caseId);

    const session: WordSession = {
      caseId,
      filePath,
      startedAt: new Date().toISOString(),
      lastMtime: stat.mtimeMs,
    };
    this.sessions.set(caseId, session);

    // Start watching the file for modifications
    this.startWatcher(session);

    // Launch Microsoft Word or the default associated app
    this.launchWord(filePath);

    return {
      ok: true,
      message: 'Microsoft Word launched',
      filePath,
      session: {
        caseId,
        startedAt: session.startedAt,
      },
    };
  }

  private launchWord(filePath: string) {
    try {
      if (process.platform === 'win32') {
        // cmd.exe /c start "" "filepath" opens the file with the default associated app (winword.exe)
        spawn('cmd.exe', ['/c', 'start', '""', filePath], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
      }
      this.log.log(`Launched Word for file: ${filePath}`);
    } catch (err: any) {
      this.log.error(`Failed to launch Word: ${err.message}`);
    }
  }

  private startWatcher(session: WordSession) {
    let debounceTimer: NodeJS.Timeout | null = null;

    const triggerSync = async () => {
      try {
        if (!fs.existsSync(session.filePath)) return;
        const curStat = fs.statSync(session.filePath);
        // Only trigger if modified
        if (curStat.mtimeMs <= session.lastMtime) return;
        session.lastMtime = curStat.mtimeMs;

        // Try reading with retry in case Word is momentarily writing/locking the file
        const buffer = await this.readFileWithRetry(session.filePath, 5, 250);
        if (!buffer) return;

        const { value: text } = await mammoth.extractRawText({ buffer });
        const parsed = parseReportText(text);

        // Update the case report draft
        await this.cases.saveReport(session.caseId, parsed, 'save');
        session.lastSavedAt = new Date().toISOString();
        this.log.log(
          `Report auto-synced from Word for case ${session.caseId} at ${session.lastSavedAt}`,
        );
      } catch (err: any) {
        this.log.warn(`Error during Word sync for case ${session.caseId}: ${err.message}`);
      }
    };

    try {
      // File system watcher
      session.watcher = fs.watch(session.filePath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            triggerSync();
          }, 500);
        }
      });

      session.watcher.on('error', (err) => {
        this.log.warn(`Watcher error on ${session.filePath}: ${err.message}`);
      });
    } catch (err: any) {
      this.log.warn(`Unable to attach fs.watch on ${session.filePath}: ${err.message}`);
    }

    // Polling backup check every 1500ms (handles atomic renames by Word)
    session.pollTimer = setInterval(() => {
      triggerSync();
    }, 1500);
  }

  private async readFileWithRetry(
    filePath: string,
    retries = 5,
    delayMs = 200,
  ): Promise<Buffer | null> {
    for (let i = 0; i < retries; i++) {
      try {
        return fs.readFileSync(filePath);
      } catch (err: any) {
        // File may be locked by Word during write
        if (i === retries - 1) {
          this.log.warn(`Failed reading ${filePath} after ${retries} attempts: ${err.message}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return null;
  }

  cleanupSession(caseId: string) {
    const s = this.sessions.get(caseId);
    if (!s) return;
    if (s.watcher) {
      try {
        s.watcher.close();
      } catch {}
    }
    if (s.pollTimer) {
      clearInterval(s.pollTimer);
    }
    this.sessions.delete(caseId);
  }
}
