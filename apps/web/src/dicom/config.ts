// DICOMweb endpoints. The browser talks to the NestJS proxy, which forwards to
// Orthanc. Same-origin in local dev (Vite proxy); absolute in docker builds.

const API_BASE =
  typeof __API_BASE__ !== 'undefined' && __API_BASE__ ? __API_BASE__ : '';

export const dicomWeb = {
  /** WADO-RS / QIDO-RS root */
  wadoRsRoot: `${API_BASE}/dicom-web`,
  /** Some loaders want an explicit QIDO root; same here */
  qidoRoot: `${API_BASE}/dicom-web`,
};

/** How many decode web workers to spin up. */
export const MAX_WEB_WORKERS = Math.max(
  1,
  Math.min(navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 : 3, 7),
);
