import {
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
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import * as path from 'path';
import archiver = require('archiver');
import { CasesService, type CaseQuery } from './cases.service';
import type { CaseRecord } from './case.types';
import { scanDicomInstances, sampleDir } from '../local/local.service';

@Controller('api/cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

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
