import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { TrackingService } from './tracking.service';
import { ReportLocationDto } from './dto';

function isAdmin(req: any): boolean {
  return req.user.roles?.includes('SUPER_ADMIN') || req.user.permissions?.includes('rides.read');
}

@Controller('rides')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post(':rideId/location') async report(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: ReportLocationDto,
  ) {
    return { data: await this.tracking.reportLocation(req.user.id, rideId, dto.lat, dto.lng) };
  }

  @Get(':rideId/location') async latest(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.tracking.latestLocation(rideId, req.user.id, isAdmin(req)) };
  }

  @Get(':rideId/route') async route(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.tracking.routeForRide(rideId, req.user.id, isAdmin(req)) };
  }
}
