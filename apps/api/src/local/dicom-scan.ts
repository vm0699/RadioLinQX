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
  /** DICOM age string, e.g. "059Y" */
  patientAge?: string;
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

const PIXEL_DATA = 'x7fe00010';
/** Everything we index sits well before PixelData; 256 KB covers the header of any normal file. */
const HEADER_BYTES = 256 * 1024;
const BATCH = 24;

/**
 * Parse one file's header. Reads only the first HEADER_BYTES and stops at PixelData —
 * a scan of hundreds of slices stays cheap. If the header turns out longer than that
 * (parser overrun) the whole file is read instead.
 */
async function readHeader(filePath: string): Promise<dicomParser.DataSet | null> {
  const attempt = (bytes: Buffer) => {
    // Cheap DICOM sniff: "DICM" magic at offset 128.
    if (bytes.length < 132 || bytes.toString('ascii', 128, 132) !== 'DICM') return null;
    return dicomParser.parseDicom(new Uint8Array(bytes), { untilTag: PIXEL_DATA });
  };
  let fh: import('fs').promises.FileHandle | undefined;
  try {
    fh = await fs.open(filePath, 'r');
    const { size } = await fh.stat();
    const head = Buffer.alloc(Math.min(size, HEADER_BYTES));
    await fh.read(head, 0, head.length, 0);
    try {
      return attempt(head);
    } catch {
      if (size <= HEADER_BYTES) return null;
    }
    return attempt(await fs.readFile(filePath));
  } catch {
    return null; // unreadable / not a parseable DICOM file
  } finally {
    await fh?.close();
  }
}

export async function scanDicomDir(dir: string): Promise<LocalInstance[]> {
  const files = await walk(dir);
  const out: LocalInstance[] = [];
  // the same SOPInstanceUID can exist in two files (e.g. a study uploaded twice) —
  // keep one so a series never contains duplicate slices
  const seenSop = new Set<string>();

  // parse in parallel batches, consume in file order so the result stays deterministic
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const parsed = await Promise.all(batch.map(readHeader));
    parsed.forEach((ds, k) => {
      if (!ds) return;
      const sop = ds.string('x00080018');
      const studyUid = ds.string('x0020000d');
      const seriesUid = ds.string('x0020000e');
      if (!sop || !studyUid || !seriesUid) return;
      if (seenSop.has(sop)) return;
      seenSop.add(sop);

      const ipp = ds.string('x00200032');
      out.push({
        filePath: batch[k],
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
        patientAge: ds.string('x00101010') || undefined,
        studyDate: ds.string('x00080020') || undefined,
        studyDescription: ds.string('x00081030') || undefined,
        seriesDescription: ds.string('x0008103e') || undefined,
        seriesNumber: num(ds.string('x00200011')),
        bodyPart: ds.string('x00180015') || undefined,
        accessionNumber: ds.string('x00080050') || undefined,
      });
    });
  }
  return out;
}
