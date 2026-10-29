import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';

/**
 * Phase 12 — wallet, payments and commission.
 *
 * Money rules (see BUSINESS-RULES.md):
 * - Balances are DERIVED from the ledger; no balance column is ever
 *   edited. Every movement is a ledger entry with an idempotency key,
 *   so a retry can never double-post.
 * - Commission is calculated on the final fare EXCLUDING the booking
 *   fee (v1 default), at the rate resolved by precedence: driver
 *   override → service+city → city → global → 15% pilot default.
 * - The applied rate, commission and rule version are stored on the
 *   ride at settlement time.
 * - WALLET rides move real money between wallets at settlement.
 * - CASH rides move no wallet money: the driver collected cash, so
 *   the commission is recorded as driver debt (a negative balance
 *   the driver clears from future wallet earnings or a top-up).
 * - Top-ups and withdrawals are request + admin approval — v1 has
 *   no payment provider that can auto-confirm, so approval is the
 *   confirmation. Payouts are a separate approval step, never an
 *   automatic transfer.
 */
export const PILOT_COMMISSION_PERCENT = 15;
export const CANCELLATION_FEE_SETTING = 'cancellation_fee_minor';

@Injectable()
export class PaymentsService {
  private readonly settleLocks = new Map<string, Promise<unknown>>();

  constructor(@Inject(STORE) private readonly store: Store) {}

  private async withRideLock<T>(rideId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.settleLocks.get(rideId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.settleLocks.set(rideId, run.then(() => undefined, () => undefined));
    return run;
  }

  async listOwnTopups(userId: string) {
    return this.store.listTopups(userId);
  }

  async listOwnWithdrawals(userId: string) {
    return this.store.listWithdrawals(userId);
  }

  async listCommissionRules() {
    return this.store.listCommissionRules();
  }

  async getWallet(userId: string, role: 'CUSTOMER' | 'DRIVER') {
    const ownerType = role === 'DRIVER' ? 'DRIVER' : 'CUSTOMER';
    const account = await this.store.getOrCreateAccount(ownerType, userId, 'PKR');
    const balance = await this.store.getBalance(ownerType, userId);
    const entries = await this.store.listLedgerEntries(ownerType, userId, 50);
    return { accountId: account.id, balanceMinor: balance, currency: 'PKR', entries };
  }

  async requestTopup(userId: string, ownerType: string, amountMinor: number, reference: string | null) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Top-up amount must be a positive integer in minor units');
    }
    if (!['CUSTOMER', 'DRIVER'].includes(ownerType)) {
      throw new BadRequestException('Top-up wallet must be CUSTOMER or DRIVER');
    }
    return this.store.createTopup({
      userId, ownerType, amountMinor, currency: 'PKR', status: 'PENDING', reference, reviewedBy: null,
    });
  }

  async approveTopup(adminId: string, topupId: string) {
    const topup = await this.store.getTopup(topupId);
    if (!topup) throw new NotFoundException('Top-up not found');
    if (topup.status !== 'PENDING') throw new ConflictException(`Top-up is already ${topup.status}`);
    await this.store.setTopupStatus(topupId, 'APPROVED', adminId);
    // The top-up credits the wallet it was requested for: a customer
    // topping up to pay fares, or a driver clearing commission debt.
    const account = await this.store.getOrCreateAccount(topup.ownerType, topup.userId, 'PKR');
    await this.store.createLedgerEntry({
      accountId: account.id, entryType: 'TOP_UP', amountMinor: topup.amountMinor,
      referenceType: 'TOPUP', referenceId: topupId, actorId: adminId,
      reason: 'Wallet top-up approved', idempotencyKey: `topup:${topupId}`,
    });
    return this.store.getTopup(topupId);
  }

  async rejectTopup(adminId: string, topupId: string) {
    const topup = await this.store.getTopup(topupId);
    if (!topup) throw new NotFoundException('Top-up not found');
    if (topup.status !== 'PENDING') throw new ConflictException(`Top-up is already ${topup.status}`);
    return this.store.setTopupStatus(topupId, 'REJECTED', adminId);
  }

  async requestWithdrawal(userId: string, role: string, amountMinor: number) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Withdrawal amount must be a positive integer in minor units');
    }
    if (!['CUSTOMER', 'DRIVER'].includes(role)) {
      throw new BadRequestException('Withdrawal wallet must be CUSTOMER or DRIVER');
    }
    const ownerType = role;
    const balance = await this.store.getBalance(ownerType, userId);
    if (balance < amountMinor) {
      throw new BadRequestException('Withdrawal amount exceeds the wallet balance');
    }
    return this.store.createWithdrawal({
      userId, amountMinor, currency: 'PKR', status: 'PENDING', payoutReference: null, reviewedBy: null,
    });
  }

  async approveWithdrawal(adminId: string, withdrawalId: string, payoutReference: string | null) {
    const withdrawal = await this.store.getWithdrawal(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') throw new ConflictException(`Withdrawal is already ${withdrawal.status}`);
    // Balance is re-checked at approval time: the balance may have
    // moved since the request was made. The request stays PENDING on
    // failure so an admin can approve it later once funds exist.
    const driverBalance = await this.store.getBalance('DRIVER', withdrawal.userId);
    const customerBalance = await this.store.getBalance('CUSTOMER', withdrawal.userId);
    const balance = Math.max(driverBalance, customerBalance);
    if (balance < withdrawal.amountMinor) {
      throw new ConflictException('Wallet balance is now below the requested withdrawal amount');
    }
    const ownerType = driverBalance >= withdrawal.amountMinor ? 'DRIVER' : 'CUSTOMER';
    const account = await this.store.getOrCreateAccount(ownerType, withdrawal.userId, 'PKR');
    await this.store.createLedgerEntry({
      accountId: account.id, entryType: 'WITHDRAWAL', amountMinor: -withdrawal.amountMinor,
      referenceType: 'WITHDRAWAL', referenceId: withdrawalId, actorId: adminId,
      reason: 'Withdrawal approved (payout is an ops step outside this system)',
      idempotencyKey: `withdrawal:${withdrawalId}`,
    });
    return this.store.setWithdrawalStatus(withdrawalId, 'APPROVED', adminId, payoutReference);
  }

  async rejectWithdrawal(adminId: string, withdrawalId: string) {
    const withdrawal = await this.store.getWithdrawal(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') throw new ConflictException(`Withdrawal is already ${withdrawal.status}`);
    return this.store.setWithdrawalStatus(withdrawalId, 'REJECTED', adminId, null);
  }

  async createCommissionRule(input: {
    scope: string; cityId: string | null; serviceCode: string | null;
    driverUserId: string | null; ratePercent: number;
  }) {
    if (!['GLOBAL', 'CITY', 'SERVICE_CITY', 'DRIVER'].includes(input.scope)) {
      throw new BadRequestException(`Unknown commission scope ${input.scope}`);
    }
    if (input.scope === 'CITY' && !input.cityId) throw new BadRequestException('CITY rules need a city');
    if (input.scope === 'SERVICE_CITY' && (!input.cityId || !input.serviceCode)) {
      throw new BadRequestException('SERVICE_CITY rules need a city and a service');
    }
    if (input.scope === 'DRIVER' && !input.driverUserId) throw new BadRequestException('DRIVER rules need a driver');
    if (input.ratePercent < 0 || input.ratePercent > 100) {
      throw new BadRequestException('Commission rate must be between 0 and 100 percent');
    }
    const existing = await this.store.listCommissionRules();
    const version = Math.max(0, ...existing.filter((r) =>
      r.scope === input.scope && r.cityId === input.cityId &&
      r.serviceCode === input.serviceCode && r.driverUserId === input.driverUserId,
    ).map((r) => r.version)) + 1;
    return this.store.createCommissionRule({ ...input, version });
  }

  async getSettlement(rideId: string) {
    const ride = await this.store.getRideById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    const payment = await this.store.getPaymentByRideId(rideId);
    const refunds = payment ? await this.store.listRefundsByPayment(payment.id) : [];
    const refundedMinor = refunds.reduce((sum, r) => sum + r.amountMinor, 0);
    return {
      ride,
      payment,
      refunds,
      refundedMinor,
      commissionMinor: ride.commissionMinor,
      commissionRuleVersion: ride.commissionRuleVersion,
      driverEarningsMinor: ride.finalFareMinor !== null && ride.commissionMinor !== null
        ? ride.finalFareMinor - ride.commissionMinor : null,
    };
  }

  /**
   * Settle a COMPLETED ride. Idempotent: a PAID payment is returned
   * unchanged, and ledger entries carry per-ride keys so a retry
   * after a partial write cannot double-post.
   */
  async settleRide(rideId: string, actorId: string | null) {
    return this.withRideLock(rideId, async () => {
      const ride = await this.store.getRideById(rideId);
      if (!ride) throw new NotFoundException('Ride not found');
      if (ride.status !== 'COMPLETED') {
        throw new ConflictException(`Only COMPLETED rides can be settled (currently ${ride.status})`);
      }
      if (!ride.driverId || ride.finalFareMinor === null) {
        throw new ConflictException('Ride has no driver or final fare to settle');
      }
      const existing = await this.store.getPaymentByRideId(rideId);
      if (existing && existing.status === 'PAID') return { payment: existing, settled: false };

      const request = await this.store.getRideRequest(ride.requestId);
      const bookingFee = request?.bookingFeeMinor ?? 0;
      const commissionBase = Math.max(0, ride.finalFareMinor - bookingFee);
      const rule = await this.store.resolveCommissionRule(ride.driverId, request?.cityId ?? null, request?.serviceCode ?? '');
      const rate = rule ? Number(rule.ratePercent) : PILOT_COMMISSION_PERCENT;
      const commission = Math.round((commissionBase * rate) / 100);
      await this.store.setRideCommission(rideId, commission, rule?.version ?? 0);

      const payment = await this.store.createPayment({
        rideId, provider: ride.paymentMethod === 'WALLET' ? 'WALLET' : 'CASH',
        providerReference: null, amountMinor: ride.finalFareMinor, currency: 'PKR',
        status: 'PENDING', idempotencyKey: `ride-settle:${rideId}`,
      });

      const commissionAccount = await this.store.getOrCreateAccount('COMMISSION', null, 'PKR');
      if (ride.paymentMethod === 'WALLET') {
        const customerBalance = await this.store.getBalance('CUSTOMER', ride.customerId);
        if (customerBalance < ride.finalFareMinor) {
          await this.store.setPaymentStatus(payment.id, 'FAILED');
          return { payment: await this.store.getPaymentById(payment.id), settled: false, reason: 'INSUFFICIENT_BALANCE' };
        }
        const customerAccount = await this.store.getOrCreateAccount('CUSTOMER', ride.customerId, 'PKR');
        const driverAccount = await this.store.getOrCreateAccount('DRIVER', ride.driverId, 'PKR');
        await this.store.createLedgerEntry({
          accountId: customerAccount.id, entryType: 'RIDE_PAYMENT', amountMinor: -ride.finalFareMinor,
          referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Ride fare paid from wallet',
          idempotencyKey: `ride-pay-customer:${rideId}`,
        });
        await this.store.createLedgerEntry({
          accountId: driverAccount.id, entryType: 'RIDE_PAYMENT', amountMinor: ride.finalFareMinor - commission,
          referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Ride earnings after commission',
          idempotencyKey: `ride-pay-driver:${rideId}`,
        });
        await this.store.createLedgerEntry({
          accountId: commissionAccount.id, entryType: 'COMMISSION', amountMinor: commission,
          referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Platform commission',
          idempotencyKey: `ride-commission:${rideId}`,
        });
      } else {
        // Cash: the driver collected the fare in hand. No wallet
        // money moves; the commission is recorded as driver debt.
        const driverAccount = await this.store.getOrCreateAccount('DRIVER', ride.driverId, 'PKR');
        await this.store.createLedgerEntry({
          accountId: driverAccount.id, entryType: 'COMMISSION', amountMinor: -commission,
          referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Commission owed on a cash ride',
          idempotencyKey: `ride-commission-debt:${rideId}`,
        });
        await this.store.createLedgerEntry({
          accountId: commissionAccount.id, entryType: 'COMMISSION', amountMinor: commission,
          referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Platform commission on a cash ride',
          idempotencyKey: `ride-commission:${rideId}`,
        });
      }
      await this.store.setPaymentStatus(payment.id, 'PAID');
      return { payment: await this.store.getPaymentById(payment.id), settled: true };
    });
  }

  /** Best-effort settlement from trip completion: a trip that happened
   *  must stay completed even when the wallet is short. The failure
   *  is visible on the payment, and a later settle retries it. */
  async settleRideBestEffort(rideId: string) {
    try {
      await this.settleRide(rideId, null);
    } catch {
      // Deliberately swallowed: settlement is retryable and must
      // never roll back a completed trip.
    }
  }

  async refundPayment(adminId: string, paymentId: string, amountMinor: number, reason: string) {
    const payment = await this.store.getPaymentById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException(`Only PAID payments can be refunded (currently ${payment.status})`);
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Refund amount must be a positive integer in minor units');
    }
    const existingRefunds = await this.store.listRefundsByPayment(paymentId);
    const alreadyRefunded = existingRefunds.reduce((sum, r) => sum + r.amountMinor, 0);
    if (alreadyRefunded + amountMinor > payment.amountMinor) {
      throw new BadRequestException('Refund would exceed the payment amount');
    }
    if (!payment.rideId) throw new ConflictException('This payment has no ride to refund against');
    const ride = await this.store.getRideById(payment.rideId);
    if (!ride || !ride.driverId || ride.finalFareMinor === null || ride.commissionMinor === null) {
      throw new ConflictException('Ride settlement data is missing; cannot refund');
    }
    if (payment.provider !== 'WALLET') {
      throw new BadRequestException('Cash rides are refunded out of band; only wallet payments refund here');
    }
    // Commission reverses proportionally, so the platform does not
    // keep full commission on a refunded fare.
    const commissionReversed = Math.round((ride.commissionMinor * amountMinor) / ride.finalFareMinor);
    const refund = await this.store.createRefund({
      paymentId, rideId: payment.rideId, amountMinor, commissionReversedMinor: commissionReversed,
      reason, createdBy: adminId,
    });
    const customerAccount = await this.store.getOrCreateAccount('CUSTOMER', ride.customerId, 'PKR');
    const driverAccount = await this.store.getOrCreateAccount('DRIVER', ride.driverId, 'PKR');
    const commissionAccount = await this.store.getOrCreateAccount('COMMISSION', null, 'PKR');
    await this.store.createLedgerEntry({
      accountId: customerAccount.id, entryType: 'REFUND', amountMinor,
      referenceType: 'REFUND', referenceId: refund.id, actorId: adminId, reason,
      idempotencyKey: `refund-customer:${refund.id}`,
    });
    await this.store.createLedgerEntry({
      accountId: driverAccount.id, entryType: 'REFUND', amountMinor: -(amountMinor - commissionReversed),
      referenceType: 'REFUND', referenceId: refund.id, actorId: adminId, reason,
      idempotencyKey: `refund-driver:${refund.id}`,
    });
    await this.store.createLedgerEntry({
      accountId: commissionAccount.id, entryType: 'REFUND', amountMinor: -commissionReversed,
      referenceType: 'REFUND', referenceId: refund.id, actorId: adminId, reason,
      idempotencyKey: `refund-commission:${refund.id}`,
    });
    const totalRefunded = alreadyRefunded + amountMinor;
    await this.store.setPaymentStatus(
      paymentId, totalRefunded === payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    );
    return refund;
  }

  async getCancellationFeeMinor(): Promise<number> {
    const raw = await this.store.getSetting(CANCELLATION_FEE_SETTING);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  async setCancellationFeeMinor(adminId: string, amountMinor: number) {
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      throw new BadRequestException('Cancellation fee must be a non-negative integer in minor units');
    }
    await this.store.setSetting(CANCELLATION_FEE_SETTING, String(amountMinor), adminId);
    return { cancellationFeeMinor: amountMinor };
  }

  /**
   * Charge the configured cancellation fee after an explicit
   * customer/driver cancel of a matched ride. Pre-match cancels are
   * free (RidesService, no ride exists yet) and admin cancels never
   * charge — an ops cancellation is not the rider's or driver's bill.
   * The fee is a wallet debt if the balance is short, so it is never
   * silently dropped.
   */
  async chargeCancellationFee(rideId: string, actorRole: string, actorId: string) {
    if (actorRole === 'ADMIN') return null;
    const fee = await this.getCancellationFeeMinor();
    if (fee <= 0) return null;
    const ride = await this.store.getRideById(rideId);
    if (!ride) return null;
    const customerAccount = await this.store.getOrCreateAccount('CUSTOMER', ride.customerId, 'PKR');
    const commissionAccount = await this.store.getOrCreateAccount('COMMISSION', null, 'PKR');
    await this.store.createLedgerEntry({
      accountId: customerAccount.id, entryType: 'CANCELLATION_FEE', amountMinor: -fee,
      referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Cancellation fee for a matched ride',
      idempotencyKey: `cancel-fee:${rideId}`,
    });
    await this.store.createLedgerEntry({
      accountId: commissionAccount.id, entryType: 'CANCELLATION_FEE', amountMinor: fee,
      referenceType: 'RIDE', referenceId: rideId, actorId, reason: 'Cancellation fee for a matched ride',
      idempotencyKey: `cancel-fee-commission:${rideId}`,
    });
    return { feeMinor: fee };
  }

  async chargeCancellationFeeBestEffort(rideId: string, actorRole: string, actorId: string) {
    try {
      await this.chargeCancellationFee(rideId, actorRole, actorId);
    } catch {
      // The cancel already happened; a fee failure must not roll it
      // back. The fee row is idempotent, so ops can re-run it.
    }
  }
}
