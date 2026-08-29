import { Controller, Get } from '@nestjs/common';
import { OrthancService } from './studies/orthanc.service';

@Controller('api')
export class HealthController {
  constructor(private readonly orthanc: OrthancService) {}

  @Get('health')
  async health() {
    const orthanc = await this.orthanc.ping();
    return { status: 'ok', orthanc, ts: new Date().toISOString() };
  }
}
