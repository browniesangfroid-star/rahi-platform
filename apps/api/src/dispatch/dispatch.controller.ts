import { Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { DispatchService } from './dispatch.service';
import { LOCATION_INDEX } from './location-index';
import type { LocationIndex } from './location-index';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DispatchAdminController {
  constructor(
    private readonly dispatch: DispatchService,
    @Inject(LOCATION_INDEX) private readonly index: LocationIndex,
  ) {}

  @Post('dispatch/:requestId/run')
  @RequirePermissions('rides.assign')
  async run(@Param('requestId') requestId: string) {
    return { data: await this.dispatch.dispatch(requestId) };
  }

  @Get('live-drivers')
  @RequirePermissions('rides.read')
  async liveDrivers(@Query('cityId') cityId?: string) {
    return { data: await this.index.listOnline(cityId ?? null) };
  }
}
