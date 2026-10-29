import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { OffersService } from './offers.service';
import { CreateOfferDto, CounterOfferDto } from './dto';

function isAdmin(req: any): boolean {
  return req.user.roles?.includes('SUPER_ADMIN') || req.user.permissions?.includes('rides.read');
}

@Controller('rides')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post(':requestId/offers') async create(
    @Req() req: any, @Param('requestId') requestId: string, @Body() dto: CreateOfferDto,
  ) {
    return { data: await this.offers.createOffer(req.user.id, requestId, dto.fareMinor ?? null) };
  }

  @Get(':requestId/offers') async list(@Req() req: any, @Param('requestId') requestId: string) {
    return { data: await this.offers.listOffers(requestId, req.user.id, isAdmin(req)) };
  }

  @Post(':requestId/offers/:offerId/accept') async accept(
    @Req() req: any, @Param('offerId') offerId: string,
  ) {
    return { data: await this.offers.acceptOffer(req.user.id, offerId) };
  }

  @Post(':requestId/offers/:offerId/decline') async decline(
    @Req() req: any, @Param('offerId') offerId: string,
  ) {
    return { data: await this.offers.declineOffer(req.user.id, offerId) };
  }

  @Post(':requestId/offers/:offerId/counter') async counter(
    @Req() req: any, @Param('offerId') offerId: string, @Body() dto: CounterOfferDto,
  ) {
    return { data: await this.offers.counterOffer(req.user.id, offerId, dto.fareMinor) };
  }
}
