import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CasesService, type CaseQuery } from './cases.service';
import type { CaseRecord } from './case.types';

@Controller('api/cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  list(@Query() query: CaseQuery) {
    return this.cases.list(query);
  }

  @Get('stats')
  stats(@Query() query: CaseQuery) {
    return this.cases.stats(query);
  }

  @Get('presets')
  presets() {
    return this.cases.listPresets();
  }

  @Post('presets')
  createPreset(@Body() body: { name: string; query: Record<string, string> }) {
    return this.cases.createPreset(body.name, body.query ?? {});
  }

  @Delete('presets/:id')
  removePreset(@Param('id') id: string) {
    return this.cases.removePreset(id).then((ok) => ({ ok }));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const c = await this.cases.get(id);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post()
  create(@Body() body: Partial<CaseRecord>) {
    return this.cases.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<CaseRecord>) {
    const c = await this.cases.update(id, body);
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post(':id/assign')
  async assign(@Param('id') id: string, @Body() body: { radiologistId: string }) {
    const c = await this.cases.assign(id, body.radiologistId);
    if (!c) throw new NotFoundException('case or radiologist not found');
    return c;
  }

  @Put(':id/report')
  async report(
    @Param('id') id: string,
    @Body()
    body: {
      report: Partial<CaseRecord['report']>;
      action?: 'save' | 'sign';
    },
  ) {
    const c = await this.cases.saveReport(id, body.report, body.action ?? 'save');
    if (!c) throw new NotFoundException();
    return c;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const ok = await this.cases.remove(id);
    if (!ok) throw new NotFoundException();
    return { ok };
  }
}
