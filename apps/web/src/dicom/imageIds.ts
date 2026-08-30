// Build ordered imageIds for a series, for whichever backend is active:
//  - orthanc → WADO-RS metadata + `wadors:` imageIds (metadata pre-registered)
//  - local   → `wadouri:` imageIds pointing at /api/local/wado/:sop
//              (the wadouri loader fetches + parses the file itself)

import { api as dicomwebApi } from 'dicomweb-client';
import * as dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { dicomWeb } from './config';
import { api, API_BASE, type BackendMode } from '../api/client';

const TAG = {
  SOPInstanceUID: '00080018',
  SeriesInstanceUID: '0020000E',
  InstanceNumber: '00200013',
  NumberOfFrames: '00280008',
  ImagePositionPatient: '00200032',
} as const;

type DicomJsonInstance = Record<string, { Value?: unknown[] }>;

function firstValue(inst: DicomJsonInstance, tag: string): unknown {
  return inst?.[tag]?.Value?.[0];
}

function sortInstances(instances: DicomJsonInstance[]): DicomJsonInstance[] {
  const withPos = instances.every((i) =>
    Array.isArray(firstValue(i, TAG.ImagePositionPatient) as unknown),
  );
  if (!withPos) {
    return [...instances].sort(
      (a, b) =>
        Number(firstValue(a, TAG.InstanceNumber) ?? 0) -
        Number(firstValue(b, TAG.InstanceNumber) ?? 0),
    );
  }
  const positions = instances.map(
    (i) => (i[TAG.ImagePositionPatient]?.Value as number[]) ?? [0, 0, 0],
  );
  const spread = [0, 1, 2].map((axis) => {
    const vals = positions.map((p) => p[axis] ?? 0);
    return Math.max(...vals) - Math.min(...vals);
  });
  const axis = spread.indexOf(Math.max(...spread));
  return [...instances]
    .map((inst, idx) => ({ inst, key: positions[idx][axis] ?? 0 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.inst);
}

export interface SeriesImageIds {
  imageIds: string[];
  studyInstanceUid: string;
  seriesInstanceUid: string;
}

// --- orthanc / WADO-RS ---------------------------------------------------

async function getSeriesImageIdsWadoRs(
  studyInstanceUid: string,
  seriesInstanceUid: string,
): Promise<SeriesImageIds> {
  const client = new dicomwebApi.DICOMwebClient({
    url: dicomWeb.wadoRsRoot,
    singlepart: false,
  });
  const instances = (await client.retrieveSeriesMetadata({
    studyInstanceUID: studyInstanceUid,
    seriesInstanceUID: seriesInstanceUid,
  })) as DicomJsonInstance[];

  const ordered = sortInstances(instances);
  const wadors = (
    dicomImageLoader as unknown as {
      wadors: { metaDataManager: { add: (id: string, md: unknown) => void } };
    }
  ).wadors;

  const imageIds: string[] = [];
  for (const inst of ordered) {
    const sop = String(firstValue(inst, TAG.SOPInstanceUID));
    const seriesUid = String(
      firstValue(inst, TAG.SeriesInstanceUID) ?? seriesInstanceUid,
    );
    const frames = Number(firstValue(inst, TAG.NumberOfFrames) ?? 1) || 1;
    for (let frame = 1; frame <= frames; frame++) {
      const imageId =
        `wadors:${dicomWeb.wadoRsRoot}/studies/${studyInstanceUid}` +
        `/series/${seriesUid}/instances/${sop}/frames/${frame}`;
      wadors.metaDataManager.add(imageId, inst);
      imageIds.push(imageId);
    }
  }
  return { imageIds, studyInstanceUid, seriesInstanceUid };
}

// --- local files / WADO-URI --------------------------------------------

async function getSeriesImageIdsLocal(
  studyInstanceUid: string,
  seriesInstanceUid: string,
): Promise<SeriesImageIds> {
  const refs = await api.listLocalInstances(studyInstanceUid, seriesInstanceUid);
  const imageIds: string[] = [];
  for (const r of refs) {
    const url = `${API_BASE}/api/local/wado/${encodeURIComponent(r.sopInstanceUid)}`;
    if (r.numberOfFrames > 1) {
      for (let f = 1; f <= r.numberOfFrames; f++) {
        imageIds.push(`wadouri:${url}?frame=${f}`);
      }
    } else {
      imageIds.push(`wadouri:${url}`);
    }
  }
  return { imageIds, studyInstanceUid, seriesInstanceUid };
}

// --- dispatcher --------------------------------------------------------

export async function loadSeriesImageIds(
  mode: BackendMode,
  studyInstanceUid: string,
  seriesInstanceUid: string,
): Promise<SeriesImageIds> {
  return mode === 'local'
    ? getSeriesImageIdsLocal(studyInstanceUid, seriesInstanceUid)
    : getSeriesImageIdsWadoRs(studyInstanceUid, seriesInstanceUid);
}
