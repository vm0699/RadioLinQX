const rawOrthanc = process.env.ORTHANC_URL ?? '';

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  /** Empty when there is no Orthanc (hosted deploy) — the API runs local mode. */
  orthancUrl: rawOrthanc,
  orthancEnabled: rawOrthanc.length > 0,
  orthancUser: process.env.ORTHANC_USERNAME ?? 'radiolinq',
  orthancPass: process.env.ORTHANC_PASSWORD ?? 'change-me-orthanc',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
