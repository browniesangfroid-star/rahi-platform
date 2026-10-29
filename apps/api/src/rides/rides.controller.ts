import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { RidesService } from './rides.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CancelRideDto, EstimateDto, RequestRideDto } from './dto';

function isAdmin(req: any): boolean {
  return req.user.roles?.includes('SUPER_ADMIN') || req.user.permissions?.includes('rides.read');
}

@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('estimate') async estimate(@Body() dto: EstimateDto) {
    const result = await this.rides.estimate(dto.pickup, dto.destination, dto.service, dto.category ?? null);
    return { data: result };
  }

  @Post('request') async request(@Req() req: any, @Body() dto: RequestRideDto) {
    const request = await this.rides.requestRide({
      customerId: req.user.id,
      pickup: dto.pickup,
      destination: dto.destination,
      pickupLabel: dto.pickupLabel ?? null,
      destinationLabel: dto.destinationLabel ?? null,
      serviceCode: dto.service,
      categoryCode: dto.category ?? null,
      customerOfferMinor: dto.customerOfferMinor ?? null,
      paymentMethod: dto.paymentMethod,
      deliveryDetails: dto.deliveryDetails ? {
        senderName: dto.deliveryDetails.senderName,
        senderPhone: dto.deliveryDetails.senderPhone,
        recipientName: dto.deliveryDetails.recipientName,
        recipientPhone: dto.deliveryDetails.recipientPhone,
        packageCategory: dto.deliveryDetails.packageCategory,
        sizeWeight: dto.deliveryDetails.sizeWeight ?? null,
        notes: dto.deliveryDetails.notes ?? null,
      } : null,
    });
    // Phase 7: creation triggers matching immediately. The dispatch round
    // rides along on the response; the customer app ignores extra fields.
    // The request is re-read because dispatch may have moved its status
    // (SEARCHING -> OFFERING / NO_DRIVER_FOUND) after creation.
    const dispatchRound = await this.dispatch.dispatch(request.id);
    const fresh = await this.rides.getRequest(request.id, req.user.id, false);
    return { data: { ...fresh, dispatchRound } };
  }

  @Get() async list(@Req() req: any, @Query('status') status?: string) {
    const all = await this.rides.listMyRequests(req.user.id);
    const filtered = status ? all.filter((r) => r.status === status) : all;
    return { data: filtered };
  }

  @Get(':id') async get(@Req() req: any, @Param('id') id: string) {
    return { data: await this.rides.getRequest(id, req.user.id, isAdmin(req)) };
  }

  @Get(':id/timeline') async timeline(@Req() req: any, @Param('id') id: string) {
    return { data: await this.rides.timeline(id, req.user.id, isAdmin(req)) };
  }

  @Post(':id/cancel') async cancel(@Req() req: any, @Param('id') id: string, @Body() dto: CancelRideDto) {
    return { data: await this.rides.cancelRequest(id, req.user.id, dto.reason ?? null) };
  }
}
