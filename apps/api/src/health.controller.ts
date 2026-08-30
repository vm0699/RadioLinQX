import { Controller, Get } from '@nestjs/common';
import { OrthancService } from './studies/orthanc.service';
import { hasLocalData } from './local/local.service';

@Controller('api')
export class HealthController {
  constructor(private readonly orthanc: OrthancService) {}

  @Get('health')
  async health() {
    const orthanc = await this.orthanc.ping();
    return { status: 'ok', orthanc, ts: new Date().toISOString() };
  }

  /**
   * Which DICOM backend the frontend should talk to:
   *  - 'orthanc' → DICOMweb via the proxy, `wadors:` imageIds
   *  - 'local'   → sample-data files via /api/local, `wadouri:` imageIds
   */
  @Get('mode')
  async mode() {
    const orthanc = await this.orthanc.ping();
    if (orthanc) return { mode: 'orthanc' as const };
    const local = await hasLocalData();
    return { mode: local ? ('local' as const) : ('none' as const) };
  }
}
