import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StudiesController } from './studies/studies.controller';
import { OrthancService } from './studies/orthanc.service';

@Module({
  controllers: [HealthController, StudiesController],
  providers: [OrthancService],
})
export class AppModule {}
