import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StudiesController } from './studies/studies.controller';
import { OrthancService } from './studies/orthanc.service';
import { LocalController } from './local/local.controller';

@Module({
  controllers: [HealthController, StudiesController, LocalController],
  providers: [OrthancService],
})
export class AppModule {}
