import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as dicomParser from 'dicom-parser';
import { sampleDir, invalidateScanCache } from '../local/local.service';
import { CasesService } from '../cases/cases.service';
import type { CaseView } from '../cases/case.types';

interface ParsedInstance {
  buf: Buffer;
  sop: string;
  studyUid: string;
  seriesUid: string;
  modality?: string;
  patientId?: string;
  patientName?: string;
  patientSex?: string;
  patientAge?: number;
  studyDescription?: string;
  seriesDescription?: string;
  numberOfFrames: number;
}

function s(ds: dicomParser.DataSet, tag: string): string | undefined {
  const v = ds.string(tag);
  return v && v.length ? v : undefined;
}

/** Uploaded studies land under sample-data/uploads/<studyUid>/ so the normal
 *  local-mode scan + viewer path picks them up with zero extra wiring. */
export function uploadsDir(): string {
  return path.join(sampleDir(), 'uploads');
}

@Injectable()
export class UploadService {
  private readonly log = new Logger(UploadService.name);

  constructor(private readonly cases: CasesService) {}

  private parse(buf: Buffer): ParsedInstance | null {
    if (buf.length < 132 || buf.toString('ascii', 128, 132) !== 'DICM') return null;
    try {
      const ds = dicomParser.parseDicom(new Uint8Array(buf));
      const sop = s(ds, 'x00080018');
      const studyUid = s(ds, 'x0020000d');
      const seriesUid = s(ds, 'x0020000e');
      if (!sop || !studyUid || !seriesUid) return null;
      const ageRaw = s(ds, 'x00101010'); // e.g. "033Y"
      return {
        buf,
        sop,
        studyUid,
        seriesUid,
        modality: s(ds, 'x00080060'),
        patientId: s(ds, 'x00100020'),
        patientName: s(ds, 'x00100010')?.replace(/\^/g, ' ').trim(),
        patientSex: s(ds, 'x00100040'),
        patientAge: ageRaw ? parseInt(ageRaw, 10) || undefined : undefined,
        studyDescription: s(ds, 'x00081030'),
        seriesDescription: s(ds, 'x0008103e'),
        numberOfFrames: Number(s(ds, 'x00280008') ?? 1) || 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * Accept a batch of DICOM P10 files, group them into studies, write them to
   * disk, and create one case per study. Returns the created cases.
   */
  async ingest(
    files: { buffer: Buffer; originalname: string }[],
    meta: {
      referringDoctorName?: string;
      referringDoctorMobile?: string;
      branchId?: string;
      patientHistory?: string;
      remarks?: string;
      tags?: string[];
    } = {},
  ): Promise<{ created: CaseView[]; accepted: number; rejected: number }> {
    const parsed: ParsedInstance[] = [];
    let rejected = 0;
    for (const f of files) {
      const p = this.parse(f.buffer);
      if (p) parsed.push(p);
      else rejected++;
    }
    if (!parsed.length) return { created: [], accepted: 0, rejected };

    const byStudy = new Map<string, ParsedInstance[]>();
    for (const p of parsed) {
      const arr = byStudy.get(p.studyUid) ?? [];
      arr.push(p);
      byStudy.set(p.studyUid, arr);
    }

    const created: CaseView[] = [];
    for (const [studyUid, arr] of byStudy) {
      const dir = path.join(uploadsDir(), studyUid.replace(/[^0-9.]/g, ''));
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(
        arr.map((p) => fs.writeFile(path.join(dir, `${p.sop}.dcm`), p.buf)),
      );

      const first = arr[0];
      const seriesUids = [...new Set(arr.map((p) => p.seriesUid))];
      const imageCount = arr.reduce((n, p) => n + p.numberOfFrames, 0);

      const c = await this.cases.create({
        patientId: first.patientId,
        patientName: first.patientName || 'Unknown',
        patientAge: first.patientAge,
        patientSex: first.patientSex,
        scanType: first.modality || 'OT',
        studyDescription:
          first.studyDescription || first.seriesDescription || `${first.modality} study`,
        bodyParts: [],
        branchId: meta.branchId,
        referringDoctorName: meta.referringDoctorName,
        referringDoctorMobile: meta.referringDoctorMobile,
        patientHistory: meta.patientHistory,
        remarks: meta.remarks,
        tags: meta.tags ?? [],
        hasImages: true,
        studyInstanceUid: studyUid,
        seriesInstanceUids: seriesUids,
        imageCount,
        seriesCount: seriesUids.length,
      } as Partial<CaseView>);
      created.push(c);
      this.log.log(
        `ingested study ${studyUid}: ${arr.length} instance(s), ${seriesUids.length} series → case ${c.id}`,
      );
    }

    invalidateScanCache();
    return { created, accepted: parsed.length, rejected };
  }
}
