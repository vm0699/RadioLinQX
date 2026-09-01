import { Controller, Get, Param, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('unread-count')
  async count() {
    return { count: await this.svc.unreadCount() };
  }

  @Post('read-all')
  async readAll() {
    await this.svc.markAllRead();
    return { ok: true };
  }

  @Post(':id/read')
  async read(@Param('id') id: string) {
    await this.svc.markRead(id);
    return { ok: true };
  }
}
