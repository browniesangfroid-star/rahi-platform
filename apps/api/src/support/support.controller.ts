import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { SupportService } from './support.service';
import { CreateTicketDto, RateRideDto, ReplyTicketDto, ResolveIncidentDto, SetTicketStatusDto, ShareLinkDto, SosDto, SuspendUserDto } from './dto';

function isSupport(req: any): boolean {
  const roles: string[] = req.user?.roles ?? [];
  return roles.includes('SUPER_ADMIN') || roles.includes('SUPPORT_AGENT') || roles.includes('OPERATIONS_ADMIN');
}

@UseGuards(JwtAuthGuard)
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // ---- Ratings ----
  @Post('trips/:rideId/ratings') async rateRide(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: RateRideDto,
  ) {
    return {
      data: await this.support.rateRide(req.user.id, rideId, dto.stars, dto.comment ?? null, dto.reportReason ?? null),
    };
  }

  // ---- SOS ----
  @Post('trips/:rideId/sos') async sos(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: SosDto,
  ) {
    return { data: await this.support.createSos(req.user.id, rideId, dto.note ?? null) };
  }

  // ---- Share-trip links ----
  @Post('trips/:rideId/share') async createShare(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: ShareLinkDto,
  ) {
    return { data: await this.support.createShareLink(req.user.id, rideId, dto.ttlMinutes ?? 60) };
  }

  @Delete('trips/:rideId/share/:linkId') async revokeShare(
    @Req() req: any, @Param('rideId') rideId: string, @Param('linkId') linkId: string,
  ) {
    return { data: await this.support.revokeShareLink(req.user.id, rideId, linkId) };
  }

  // ---- Tickets (participant + support) ----
  @Post('support/tickets') async createTicket(@Req() req: any, @Body() dto: CreateTicketDto) {
    return {
      data: await this.support.createTicket(req.user.id, {
        rideId: dto.rideId ?? null, category: dto.category,
        subject: dto.subject, message: dto.message,
      }),
    };
  }

  @Get('support/tickets') async listTickets(@Req() req: any, @Query('status') status?: string) {
    return { data: await this.support.listTickets(req.user.id, isSupport(req), status ?? null) };
  }

  @Get('support/tickets/:id') async getTicket(@Req() req: any, @Param('id') id: string) {
    return { data: await this.support.getTicketWithMessages(req.user.id, isSupport(req), id) };
  }

  @Post('support/tickets/:id/messages') async reply(
    @Req() req: any, @Param('id') id: string, @Body() dto: ReplyTicketDto,
  ) {
    return { data: await this.support.replyToTicket(req.user.id, isSupport(req), id, dto.message) };
  }

  // ---- Support-only ----
  @UseGuards(PermissionsGuard)
  @RequirePermissions('support.manage')
  @Post('support/tickets/:id/status') async setTicketStatus(
    @Req() req: any, @Param('id') id: string, @Body() dto: SetTicketStatusDto,
  ) {
    return { data: await this.support.setTicketStatus(req.user.id, id, dto.status) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('support.manage')
  @Get('support/incidents') async listIncidents(@Query('status') status?: string) {
    return { data: await this.support.listIncidents(status ?? null) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('support.manage')
  @Post('support/incidents/:id/resolve') async resolveIncident(
    @Req() req: any, @Param('id') id: string, @Body() dto: ResolveIncidentDto,
  ) {
    return { data: await this.support.resolveIncident(req.user.id, id, dto.resolutionNote) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('support.manage')
  @Get('admin/support/review-queue') async reviewQueue() {
    return { data: await this.support.getReviewQueue() };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('support.manage')
  @Post('admin/trips/:rideId/reset-pin') async resetPin(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.support.resetPin(req.user.id, rideId) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.suspend')
  @Patch('admin/users/:id/suspend') async suspendUser(
    @Req() req: any, @Param('id') id: string, @Body() dto: SuspendUserDto,
  ) {
    return { data: await this.support.suspendUser(req.user.id, id, dto.reason) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.suspend')
  @Patch('admin/users/:id/unsuspend') async unsuspendUser(@Req() req: any, @Param('id') id: string) {
    return { data: await this.support.unsuspendUser(req.user.id, id) };
  }
}

@UseGuards()
@Controller('share')
export class ShareController {
  constructor(private readonly support: SupportService) {}

  // Public: no auth. The token is the only credential, and it is
  // time-limited, revocable, and stored hashed.
  @Get(':token') async viewShared(@Param('token') token: string) {
    return { data: await this.support.viewSharedTrip(token) };
  }
}
