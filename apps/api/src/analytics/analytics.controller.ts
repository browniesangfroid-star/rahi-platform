import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { AnalyticsService } from './analytics.service';

function daysFrom(query: { days?: string }): number {
  return query.days === undefined ? 30 : Number(query.days);
}

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermissions('reports.read')
  @Get('overview')
  async overview(@Query() query: { days?: string }) {
    return { data: await this.analytics.overview(daysFrom(query)) };
  }

  @RequirePermissions('reports.read')
  @Get('dispatch')
  async dispatch(@Query() query: { days?: string }) {
    return { data: await this.analytics.dispatch(daysFrom(query)) };
  }

  @RequirePermissions('reports.read')
  @Get('cities')
  async cities(@Query() query: { days?: string }) {
    return { data: await this.analytics.cities(daysFrom(query)) };
  }

  @RequirePermissions('reports.read')
  @Get('drivers')
  async drivers(@Query() query: { days?: string; limit?: string }) {
    return { data: await this.analytics.drivers(daysFrom(query), query.limit === undefined ? 20 : Number(query.limit)) };
  }

  @RequirePermissions('reports.read')
  @Get('daily')
  async daily(@Query() query: { days?: string }) {
    return { data: await this.analytics.daily(daysFrom(query)) };
  }

  @RequirePermissions('reports.read')
  @Get('fairness/:cityId')
  async fairness(@Param('cityId') cityId: string) {
    return { data: await this.analytics.fairness(cityId) };
  }
}
