import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { CasesService } from '../cases/cases.service';

@Controller('api')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly cases: CasesService,
  ) {}

  @Get('chat/threads')
  threads() {
    return this.chat.threads();
  }

  @Get('cases/:id/chat')
  async caseThread(@Param('id') id: string) {
    const c = await this.cases.get(id);
    return this.chat.thread(id, c?.patientName ?? '');
  }

  @Post('cases/:id/chat')
  async postMessage(
    @Param('id') id: string,
    @Body() body: { author?: string; role?: any; text: string },
  ) {
    const c = await this.cases.get(id);
    return this.chat.post(
      id,
      { author: body.author ?? 'You', role: body.role ?? 'centre', text: body.text },
      c?.patientName ?? '',
    );
  }
}
