import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService, type AppSettings } from './settings.service';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(@Body() body: Partial<AppSettings>) {
    return this.settings.update(body);
  }
}
