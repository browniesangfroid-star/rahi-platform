import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { PaymentsService } from './payments.service';
import { CancellationFeeDto, CommissionRuleDto, RefundDto, TopupDto, WithdrawalDto, ApproveWithdrawalDto } from './dto';

function isAdmin(req: any): boolean {
  return req.user?.roles?.includes('SUPER_ADMIN') || req.user?.roles?.includes('FINANCE_ADMIN');
}

@UseGuards(JwtAuthGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ---- Own wallet ----
  @Get('wallet/me') async myWallet(@Req() req: any, @Query('role') role?: string) {
    const walletRole: 'DRIVER' | 'CUSTOMER' = role === 'DRIVER' ? 'DRIVER' : 'CUSTOMER';
    return { data: await this.payments.getWallet(req.user.id, walletRole) };
  }

  @Post('wallet/topups') async requestTopup(@Req() req: any, @Body() dto: TopupDto) {
    return {
      data: await this.payments.requestTopup(req.user.id, dto.ownerType, dto.amountMinor, dto.reference ?? null),
    };
  }

  @Get('wallet/topups') async myTopups(@Req() req: any) {
    return { data: await this.payments.listOwnTopups(req.user.id) };
  }

  @Post('wallet/withdrawals') async requestWithdrawal(@Req() req: any, @Body() dto: WithdrawalDto) {
    return {
      data: await this.payments.requestWithdrawal(req.user.id, dto.ownerType, dto.amountMinor),
    };
  }

  @Get('wallet/withdrawals') async myWithdrawals(@Req() req: any) {
    return { data: await this.payments.listOwnWithdrawals(req.user.id) };
  }

  // ---- Settlement & payment status ----
  @Post('payments/rides/:rideId/settle') async settle(@Req() req: any, @Param('rideId') rideId: string) {
    const settlement = await this.payments.getSettlement(rideId);
    const ride = settlement.ride;
    if (ride.customerId !== req.user.id && ride.driverId !== req.user.id && !isAdmin(req)) {
      throw new ForbiddenException('Only the ride participants or an admin can settle a ride');
    }
    return { data: await this.payments.settleRide(rideId, req.user.id) };
  }

  @Get('payments/rides/:rideId') async settlement(@Req() req: any, @Param('rideId') rideId: string) {
    const settlement = await this.payments.getSettlement(rideId);
    const ride = settlement.ride;
    if (ride.customerId !== req.user.id && ride.driverId !== req.user.id && !isAdmin(req)) {
      throw new ForbiddenException('Only the ride participants or an admin can view a settlement');
    }
    return { data: settlement };
  }

  // ---- Admin: top-ups, withdrawals, refunds, commission, fees ----
  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Post('admin/wallet/topups/:id/approve') async approveTopup(@Req() req: any, @Param('id') id: string) {
    return { data: await this.payments.approveTopup(req.user.id, id) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Post('admin/wallet/topups/:id/reject') async rejectTopup(@Req() req: any, @Param('id') id: string) {
    return { data: await this.payments.rejectTopup(req.user.id, id) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Post('admin/wallet/withdrawals/:id/approve') async approveWithdrawal(
    @Req() req: any, @Param('id') id: string, @Body() dto: ApproveWithdrawalDto,
  ) {
    return { data: await this.payments.approveWithdrawal(req.user.id, id, dto.payoutReference ?? null) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Post('admin/wallet/withdrawals/:id/reject') async rejectWithdrawal(@Req() req: any, @Param('id') id: string) {
    return { data: await this.payments.rejectWithdrawal(req.user.id, id) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('refunds.manage')
  @Post('admin/payments/:paymentId/refund') async refund(
    @Req() req: any, @Param('paymentId') paymentId: string, @Body() dto: RefundDto,
  ) {
    return { data: await this.payments.refundPayment(req.user.id, paymentId, dto.amountMinor, dto.reason) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('commission.manage')
  @Post('admin/commission-rules') async createRule(@Body() dto: CommissionRuleDto) {
    return {
      data: await this.payments.createCommissionRule({
        scope: dto.scope, cityId: dto.cityId ?? null, serviceCode: dto.serviceCode ?? null,
        driverUserId: dto.driverUserId ?? null, ratePercent: dto.ratePercent,
      }),
    };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('commission.manage')
  @Get('admin/commission-rules') async listRules() {
    return { data: await this.payments.listCommissionRules() };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Post('admin/settings/cancellation-fee') async setFee(@Req() req: any, @Body() dto: CancellationFeeDto) {
    return { data: await this.payments.setCancellationFeeMinor(req.user.id, dto.amountMinor) };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('payments.manage')
  @Get('admin/settings/cancellation-fee') async getFee() {
    return { data: { cancellationFeeMinor: await this.payments.getCancellationFeeMinor() } };
  }
}
