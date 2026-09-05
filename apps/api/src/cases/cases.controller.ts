import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import archiver = require('archiver');
import * as mammoth from 'mammoth';
import { CasesService, type CaseQuery } from './cases.service';
import type { CaseRecord } from './case.types';
import { buildReportDocx, parseReportText } from './report-docx';
import { SettingsService } from '../settings/settings.service';
import { scanDicomInstances, sampleDir } from '../local/local.service';
import { dataDir } from '../store/json-store';

@Controller('api/cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  list(@Query() query: CaseQuery) {
    return this.cases.list(query);
  }

  @Get('stats')
  stats(@Query() query: CaseQuery) {
    return this.cases.stats(query);
  }

  @Get('presets')
  presets() {
    return this.cases.listPresets();
  }

  @Post('presets')
  createPreset(@Body() body: { name: string; query: Record<string, string> }) {
    return this.cases.createPreset(body.name, body.query ?? {});
  }

  @Delete('presets/:id')
  removePreset(@Param('id') id: string) {
    return this.cases.removePreset(id).then((ok) => ({ ok }));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const c = await this.cases.get(id);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post()
  create(@Body() body: Partial<CaseRecord>) {
    return this.cases.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<CaseRecord>) {
    const c = await this.cases.update(id, body);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post(':id/assign')
  async assign(@Param('id') id: string, @Body() body: { radiologistId: string }) {
    const c = await this.cases.assign(id, body.radiologistId);
    if (!c) throw new NotFoundException('case or radiologist not found');
    return c;
  }

  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string) {
    const c = await this.cases.duplicate(id);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post(':id/link')
  async link(
    @Param('id') id: string,
    @Body() body: { otherId: string; unlink?: boolean },
  ) {
    const c = await this.cases.link(id, body.otherId, !!body.unlink);
    if (!c) throw new BadRequestException('invalid case ids');
    return c;
  }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    const h = await this.cases.listHistory(id);
    if (!h) throw new NotFoundException();
    return h;
  }

  /** Report only, as plain text. */
  @Get(':id/report.txt')
  async reportText(@Param('id') id: string, @Res() res: Response) {
    const c = await this.cases.get(id);
    if (!c) throw new NotFoundException();
    const r = c.report;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${c.caseNumber}-report.txt"`,
    );
    res.send(
      [
        `${c.caseNumber} — ${c.patientName} (${c.patientId})`,
        `${c.scanType} · ${c.studyDescription ?? ''}`,
        `Referring: ${c.referringDoctorName ?? '-'}`,
        ``,
        r ? `CLINICAL HISTORY\n${r.clinicalHistory}\n` : 'No report authored yet.',
        r ? `TECHNIQUE\n${r.technique}\n` : '',
        r ? `FINDINGS\n${r.findings}\n` : '',
        r ? `IMPRESSION\n${r.impression}\n` : '',
        r?.signedBy ? `\nElectronically signed by ${r.signedBy} — ${r.signedAt}` : '',
      ].join('\n'),
    );
  }

  /** The report as a Word (.docx) letterhead — pre-filled with whatever has
   *  been authored so far, ready to hand to the doctor for editing offline. */
  @Get(':id/report.docx')
  async reportDocx(@Param('id') id: string, @Res() res: Response) {
    const c = await this.cases.get(id);
    if (!c) throw new NotFoundException();
    const settings = await this.settings.get();
    const buf = await buildReportDocx(c, settings);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${c.caseNumber}-report.docx"`,
    );
    res.send(buf);
  }

  /** Re-import a doctor-edited .docx: pulls the section text back out and
   *  saves it as the case's report draft (same effect as "Save draft"). */
  @Post(':id/report/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async importReportDocx(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException('no file');
    const { value: text } = await mammoth.extractRawText({ buffer: file.buffer });
    const parsed = parseReportText(text);
    const c = await this.cases.saveReport(id, parsed, 'save');
    if (!c) throw new NotFoundException();
    return c;
  }

  // ---- attachments ----
  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async addAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) {
    if (!files?.length) throw new BadRequestException('no files');
    const dir = path.join(dataDir(), 'attachments', id);
    await fsp.mkdir(dir, { recursive: true });
    let last;
    for (const f of files) {
      const aid = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const safeName = f.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const file = `${aid}__${safeName}`;
      await fsp.writeFile(path.join(dir, file), f.buffer);
      last = await this.cases.recordAttachment(id, {
        id: aid,
        name: safeName,
        size: f.buffer.length,
        mime: f.mimetype || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        file,
      });
    }
    if (!last) throw new NotFoundException();
    return last;
  }

  @Get(':id/attachments/:aid')
  async getAttachment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Res() res: Response,
  ) {
    const c = await this.cases.get(id);
    const att = c?.attachments?.find((a) => a.id === aid);
    if (!att) throw new NotFoundException();
    const abs = path.resolve(dataDir(), 'attachments', id, att.file);
    if (!abs.startsWith(path.resolve(dataDir(), 'attachments'))) {
      throw new NotFoundException();
    }
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${att.name}"`);
    createReadStream(abs).pipe(res);
  }

  /** Zip of the case's DICOM instances + a report.txt. */
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const c = await this.cases.get(id);
    if (!c) throw new NotFoundException();

    const zip = archiver('zip', { zlib: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${c.caseNumber}.zip"`,
    );
    zip.on('error', () => res.status(500).end());
    zip.pipe(res);

    if (c.hasImages && c.studyInstanceUid) {
      const root = path.resolve(sampleDir());
      const instances = (await scanDicomInstances()).filter(
        (i) => i.studyInstanceUid === c.studyInstanceUid,
      );
      for (const inst of instances) {
        const abs = path.resolve(inst.filePath);
        if (abs.startsWith(root)) {
          zip.append(createReadStream(abs), {
            name: `DICOM/${inst.seriesInstanceUid}/${inst.sopInstanceUid}.dcm`,
          });
        }
      }
    }

    const r = c.report;
    zip.append(
      [
        `Case: ${c.caseNumber}`,
        `Patient: ${c.patientName} (${c.patientId})  ${c.patientAge ?? '?'}/${c.patientSex ?? '?'}`,
        `Study: ${c.scanType} — ${c.studyDescription ?? ''}`,
        `Referring: ${c.referringDoctorName ?? '-'}`,
        `Status: ${c.status}`,
        ``,
        r ? `CLINICAL HISTORY\n${r.clinicalHistory}\n` : `No report yet.`,
        r ? `TECHNIQUE\n${r.technique}\n` : ``,
        r ? `FINDINGS\n${r.findings}\n` : ``,
        r ? `IMPRESSION\n${r.impression}\n` : ``,
        r?.signedBy ? `\nSigned by ${r.signedBy} at ${r.signedAt}` : ``,
      ].join('\n'),
      { name: 'report.txt' },
    );

    await zip.finalize();
  }

  @Put(':id/report')
  async report(
    @Param('id') id: string,
    @Body()
    body: {
      report: Partial<CaseRecord['report']>;
      action?: 'save' | 'sign';
    },
  ) {
    const c = await this.cases.saveReport(id, body.report, body.action ?? 'save');
    if (!c) throw new NotFoundException();
    return c;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const ok = await this.cases.remove(id);
    if (!ok) throw new NotFoundException();
    return { ok };
  }
}
