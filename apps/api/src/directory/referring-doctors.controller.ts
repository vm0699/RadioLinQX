import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ReferringDoctorsService,
  type ReferringDoctor,
} from './referring-doctors.service';

@Controller('api/referring-doctors')
export class ReferringDoctorsController {
  constructor(private readonly svc: ReferringDoctorsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const d = await this.svc.get(id);
    if (!d) throw new NotFoundException();
    return d;
  }

  @Post()
  create(
    @Body()
    body: Omit<ReferringDoctor, 'id' | 'casesReferred' | 'createdAt'>,
  ) {
    return this.svc.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<ReferringDoctor>) {
    const d = await this.svc.update(id, body);
    if (!d) throw new NotFoundException();
    return d;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const ok = await this.svc.remove(id);
    if (!ok) throw new NotFoundException();
    return { ok };
  }
}
