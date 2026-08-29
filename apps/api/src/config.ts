export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  orthancUrl: process.env.ORTHANC_URL ?? 'http://orthanc:8042',
  orthancUser: process.env.ORTHANC_USERNAME ?? 'radiolinq',
  orthancPass: process.env.ORTHANC_PASSWORD ?? 'change-me-orthanc',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
