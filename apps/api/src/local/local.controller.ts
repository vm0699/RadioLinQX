import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import * as path from 'path';
import { scanDicomInstances, sampleDir } from './local.service';

/**
 * No-Docker fallback: serve the DICOM files under sample-data/ directly.
 * QIDO-ish JSON for the study/series lists + raw `application/dicom` bytes that
 * Cornerstone's `wadouri:` loader consumes. Used when Orthanc is unreachable.
 */
@Controller('api/local')
export class LocalController {
  @Get('studies')
  async studies() {
    const instances = await scanDicomInstances();
    const byStudy = new Map<string, typeof instances>();
    for (const i of instances) {
      const arr = byStudy.get(i.studyInstanceUid) ?? [];
      arr.push(i);
      byStudy.set(i.studyInstanceUid, arr);
    }
    return [...byStudy.values()].map((arr) => {
      const first = arr[0];
      const seriesUids = new Set(arr.map((i) => i.seriesInstanceUid));
      return {
        studyInstanceUid: first.studyInstanceUid,
        patientId: first.patientId,
        patientName: first.patientName,
        patientSex: first.patientSex,
        patientBirthDate: first.patientBirthDate,
        studyDate: first.studyDate,
        accessionNumber: first.accessionNumber,
        studyDescription: first.studyDescription,
        modalities: [...new Set(arr.map((i) => i.modality).filter(Boolean))].join(
          '\\',
        ),
        seriesCount: seriesUids.size,
        instanceCount: arr.reduce((n, i) => n + i.numberOfFrames, 0),
      };
    });
  }

  @Get('studies/:studyUid/series')
  async series(@Param('studyUid') studyUid: string) {
    const instances = (await scanDicomInstances()).filter(
      (i) => i.studyInstanceUid === studyUid,
    );
    const bySeries = new Map<string, typeof instances>();
    for (const i of instances) {
      const arr = bySeries.get(i.seriesInstanceUid) ?? [];
      arr.push(i);
      bySeries.set(i.seriesInstanceUid, arr);
    }
    return [...bySeries.values()]
      .map((arr) => {
        const first = arr[0];
        return {
          seriesInstanceUid: first.seriesInstanceUid,
          seriesNumber: first.seriesNumber,
          modality: first.modality,
          seriesDescription: first.seriesDescription,
          bodyPart: first.bodyPart,
          instanceCount: arr.reduce((n, i) => n + i.numberOfFrames, 0),
        };
      })
      .sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0));
  }

  /**
   * Ordered SOPInstanceUIDs for a series (spatial order when ImagePositionPatient
   * is present, else InstanceNumber). The frontend turns these into
   * `wadouri:` imageIds.
   */
  @Get('studies/:studyUid/series/:seriesUid/instances')
  async instances(
    @Param('studyUid') studyUid: string,
    @Param('seriesUid') seriesUid: string,
  ) {
    const arr = (await scanDicomInstances()).filter(
      (i) => i.studyInstanceUid === studyUid && i.seriesInstanceUid === seriesUid,
    );
    const haveIpp = arr.every((i) => Array.isArray(i.imagePositionPatient));
    if (haveIpp) {
      const axis = dominantAxis(arr.map((i) => i.imagePositionPatient!));
      arr.sort(
        (a, b) =>
          (a.imagePositionPatient![axis] ?? 0) -
          (b.imagePositionPatient![axis] ?? 0),
      );
    } else {
      arr.sort((a, b) => a.instanceNumber - b.instanceNumber);
    }
    return arr.map((i) => ({
      sopInstanceUid: i.sopInstanceUid,
      numberOfFrames: i.numberOfFrames,
    }));
  }

  /** Raw DICOM Part-10 bytes for one instance. */
  @Get('wado/:sop')
  @Header('Content-Type', 'application/dicom')
  @Header('Cache-Control', 'public, max-age=86400')
  async wado(@Param('sop') sop: string, @Res() res: Response) {
    const instances = await scanDicomInstances();
    const hit = instances.find((i) => i.sopInstanceUid === sop);
    if (!hit) throw new NotFoundException(`No local instance ${sop}`);
    // guard against path traversal — filePath always comes from our own scan
    const safe = path.resolve(hit.filePath);
    if (!safe.startsWith(path.resolve(sampleDir()))) {
      throw new NotFoundException();
    }
    createReadStream(safe).pipe(res);
  }
}

function dominantAxis(positions: number[][]): number {
  const spread = [0, 1, 2].map((ax) => {
    const vals = positions.map((p) => p[ax] ?? 0);
    return Math.max(...vals) - Math.min(...vals);
  });
  return spread.indexOf(Math.max(...spread));
}
