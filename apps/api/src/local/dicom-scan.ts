import { promises as fs } from 'fs';
import * as path from 'path';
import * as dicomParser from 'dicom-parser';

export interface LocalInstance {
  filePath: string;
  sopInstanceUid: string;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  instanceNumber: number;
  numberOfFrames: number;
  imagePositionPatient?: number[];
  // study/series descriptive fields (repeated per instance, deduped later)
  modality?: string;
  patientName?: string;
  patientId?: string;
  patientSex?: string;
  patientBirthDate?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  seriesNumber?: number;
  bodyPart?: string;
  accessionNumber?: string;
}

const DICOM_EXT = /\.(dcm|dicom|ima)$/i;

async function walk(dir: string): Promise<string[]> {
  let out: string[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(await walk(full));
    } else if (e.isFile() && (DICOM_EXT.test(e.name) || !path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function personName(v: string | undefined): string | undefined {
  return v ? v.replace(/\^/g, ' ').trim() : undefined;
}

export async function scanDicomDir(dir: string): Promise<LocalInstance[]> {
  const files = await walk(dir);
  const out: LocalInstance[] = [];

  for (const filePath of files) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      continue;
    }
    // Cheap DICOM sniff: "DICM" magic at offset 128.
    if (buf.length < 132 || buf.toString('ascii', 128, 132) !== 'DICM') {
      continue;
    }
    try {
      const ds = dicomParser.parseDicom(new Uint8Array(buf));
      const sop = ds.string('x00080018');
      const studyUid = ds.string('x0020000d');
      const seriesUid = ds.string('x0020000e');
      if (!sop || !studyUid || !seriesUid) continue;

      const ipp = ds.string('x00200032');
      out.push({
        filePath,
        sopInstanceUid: sop,
        studyInstanceUid: studyUid,
        seriesInstanceUid: seriesUid,
        instanceNumber: num(ds.string('x00200013')) ?? 0,
        numberOfFrames: num(ds.string('x00280008')) ?? 1,
        imagePositionPatient: ipp
          ? ipp.split('\\').map((s) => Number(s))
          : undefined,
        modality: ds.string('x00080060') || undefined,
        patientName: personName(ds.string('x00100010')),
        patientId: ds.string('x00100020') || undefined,
        patientSex: ds.string('x00100040') || undefined,
        patientBirthDate: ds.string('x00100030') || undefined,
        studyDate: ds.string('x00080020') || undefined,
        studyDescription: ds.string('x00081030') || undefined,
        seriesDescription: ds.string('x0008103e') || undefined,
        seriesNumber: num(ds.string('x00200011')),
        bodyPart: ds.string('x00180015') || undefined,
        accessionNumber: ds.string('x00080050') || undefined,
      });
    } catch {
      /* not a parseable DICOM file */
    }
  }
  return out;
}
