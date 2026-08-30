import * as path from 'path';
import { scanDicomDir, type LocalInstance } from './dicom-scan';

/** Where the sample DICOM files live (override with SAMPLE_DIR). */
export function sampleDir(): string {
  return (
    process.env.SAMPLE_DIR ??
    path.resolve(__dirname, '../../../../sample-data')
  );
}

let cache: { at: number; data: LocalInstance[] } | null = null;
const TTL_MS = 5_000;

/** Cached recursive scan of sampleDir(). */
export async function scanDicomInstances(): Promise<LocalInstance[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await scanDicomDir(sampleDir());
  cache = { at: Date.now(), data };
  return data;
}

export async function hasLocalData(): Promise<boolean> {
  return (await scanDicomInstances()).length > 0;
}
