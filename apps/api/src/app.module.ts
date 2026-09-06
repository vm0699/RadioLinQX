import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StudiesController } from './studies/studies.controller';
import { OrthancService } from './studies/orthanc.service';
import { LocalController } from './local/local.controller';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { ReferringDoctorsController } from './directory/referring-doctors.controller';
import { ReferringDoctorsService } from './directory/referring-doctors.service';
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { WordSyncService } from './cases/word-sync.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';

@Module({
  controllers: [
    HealthController,
    StudiesController,
    LocalController,
    SettingsController,
    ReferringDoctorsController,
    CasesController,
    NotificationsController,
    ChatController,
    UploadController,
  ],
  providers: [
    OrthancService,
    SettingsService,
    ReferringDoctorsService,
    CasesService,
    WordSyncService,
    NotificationsService,
    ChatService,
    UploadService,
  ],
})
export class AppModule {}
