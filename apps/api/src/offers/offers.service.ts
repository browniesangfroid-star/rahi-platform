import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { OfferRecord, RideRequestRecord, Store } from '../data/store.interface';
import { generatePin } from '../trips/pin';
import { DeliveryService } from '../delivery/delivery.service';

/**
 * Fare bidding (Phase 8). One LIVE offer per driver per request (the
 * unique index from migration 002 is the database guard; the service
 * checks it first for a clean 409). Accept is the one-winner moment:
 * it is serialised per request by an in-process lock chain, so two
 * concurrent accepts cannot both create a ride — and the rides table
 * has a UNIQUE request_id as a second guard. Phase 16 adds the
 * multi-instance answer: Postgres accepts run as one transaction
 * with the request row locked (see acceptOfferAtomic); the
 * in-process lock path remains for the in-memory store only.
 *
 * Fare rules, by pricing mode (same bands as Phase 6):
 * - NEGOTIATION: driver fare required, must be >= the request's
 *   minimum fare (stored at creation, never re-read from a rule that
 *   may have changed since).
 * - FIXED / DYNAMIC: the platform fare applies; any driver fare is
 *   ignored, and counter-offers are refused.
 * - HYBRID: driver fare required, within ±20% of the suggested fare.
 */
@Injectable()
export class OffersService {
  private readonly acceptLocks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(STORE) private readonly store: Store,
    private readonly delivery: DeliveryService,
  ) {}

  private async withRequestLock<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.acceptLocks.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    this.acceptLocks.set(requestId, chain);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.acceptLocks.get(requestId) === chain) {
        this.acceptLocks.delete(requestId);
      }
    }
  }

  private async loadRequest(requestId: string) {
    const request = await this.store.getRideRequest(requestId);
    if (!request) throw new NotFoundException('Ride request not found');
    return request;
  }

  private async expireIfNeeded(request: RideRequestRecord): Promise<RideRequestRecord> {
    if (request.status === 'OFFERING' && request.expiresAt && request.expiresAt.getTime() < Date.now()) {
      await this.store.setRideRequestStatus(request.id, 'EXPIRED');
      await this.store.addRequestHistory({
        requestId: request.id, fromStatus: 'OFFERING', toStatus: 'EXPIRED',
        actorId: null, actorRole: 'SYSTEM', reason: 'Request expired before an offer was accepted',
      });
      const offers = await this.store.listOffersByRequest(request.id);
      for (const offer of offers) {
        if (offer.status === 'LIVE') await this.store.setOfferStatus(offer.id, 'EXPIRED');
      }
      return { ...request, status: 'EXPIRED' };
    }
    return request;
  }

  private validateFare(request: RideRequestRecord, fareMinor: number | null): number {
    const mode = request.pricingMode;
    if (mode === 'FIXED' || mode === 'DYNAMIC') return request.suggestedFareMinor;
    if (fareMinor === null || fareMinor === undefined) {
      throw new BadRequestException('A fare is required for this pricing mode');
    }
    if (mode === 'NEGOTIATION') {
      const minimum = request.minimumFareMinor ?? 0;
      if (fareMinor < minimum) {
        throw new BadRequestException(`Offer is below the minimum fare of ${minimum} minor units`);
      }
      return fareMinor;
    }
    if (mode === 'HYBRID') {
      const low = Math.round(request.suggestedFareMinor * 0.8);
      const high = Math.round(request.suggestedFareMinor * 1.2);
      if (fareMinor < low || fareMinor > high) {
        throw new BadRequestException(`In hybrid mode the offer must be within 20% of the suggested fare (${low}–${high} minor units)`);
      }
      return fareMinor;
    }
    return fareMinor;
  }

  private async requireDispatched(requestId: string, driverId: string) {
    const attempts = await this.store.listDispatchAttempts(requestId);
    const offered = attempts.some((a) => a.driverUserId === driverId && a.outcome === 'OFFERED');
    if (!offered) {
      throw new ForbiddenException('Driver was not dispatched for this request');
    }
  }

  private async requireEligibleDriver(driverId: string) {
    const profile = await this.store.getDriverProfile(driverId);
    if (!profile || profile.kycStatus !== 'APPROVED') {
      throw new ConflictException('Driver is not approved');
    }
    const vehicles = await this.store.listVehiclesByOwner(driverId);
    const active = vehicles.find((v) => v.isActive && v.approvalStatus === 'APPROVED');
    if (!active) throw new ConflictException('Driver has no active approved vehicle');
    return active;
  }

  async createOffer(driverId: string, requestId: string, fareMinor: number | null) {
    let request = await this.loadRequest(requestId);
    request = await this.expireIfNeeded(request);
    if (request.status !== 'OFFERING') {
      throw new ConflictException(`Cannot offer on a request in status ${request.status}`);
    }
    // Decline is checked before dispatch: declining flips the attempt
    // outcome from OFFERED to DECLINED, so a declined driver would
    // otherwise fall through to the less accurate "not dispatched" error.
    const declined = await this.store.getDeclinedDriverIds(requestId);
    if (declined.includes(driverId)) {
      throw new ConflictException('Driver declined this request and cannot offer again');
    }
    await this.requireDispatched(requestId, driverId);
    await this.requireEligibleDriver(driverId);
    const existing = await this.store.listOffersByRequest(requestId);
    if (existing.some((o) => o.driverId === driverId && o.status === 'LIVE')) {
      throw new ConflictException('Driver already has a live offer on this request');
    }
    const fare = this.validateFare(request, fareMinor);
    return this.store.createOffer({
      requestId, driverId, proposedFareMinor: fare, status: 'LIVE',
      expiresAt: request.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000), counterCount: 0,
    });
  }

  async declineOffer(driverId: string, offerId: string) {
    const offer = await this.store.getOffer(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.driverId !== driverId) throw new ForbiddenException('Not authorised to decline this offer');
    if (offer.status !== 'LIVE') throw new ConflictException(`Cannot decline an offer in status ${offer.status}`);
    await this.store.setOfferStatus(offerId, 'DECLINED');
    await this.store.setDispatchAttemptOutcome(offer.requestId, driverId, 'DECLINED');
    return this.store.getOffer(offerId);
  }

  async counterOffer(driverId: string, offerId: string, fareMinor: number) {
    const offer = await this.store.getOffer(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.driverId !== driverId) throw new ForbiddenException('Not authorised to counter this offer');
    if (offer.status !== 'LIVE') throw new ConflictException(`Cannot counter an offer in status ${offer.status}`);
    const request = await this.loadRequest(offer.requestId);
    if (request.pricingMode === 'FIXED' || request.pricingMode === 'DYNAMIC') {
      throw new ConflictException('Counter-offers are not available for fixed fares');
    }
    const fare = this.validateFare(request, fareMinor);
    return this.store.updateOfferFare(offerId, fare, offer.counterCount + 1);
  }

  async acceptOffer(customerId: string, offerId: string) {
    const offer = await this.store.getOffer(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    // Phase 16: stores with a transactional accept (Postgres) take
    // the single-transaction path, which serialises concurrent
    // accepts across API instances via a row lock. Stores without
    // it (InMemory) keep the per-process lock path below.
    if (typeof this.store.acceptOfferAtomic === 'function') {
      let request = await this.loadRequest(offer.requestId);
      if (request.customerId !== customerId) {
        throw new ForbiddenException('Not authorised to accept offers on this ride');
      }
      request = await this.expireIfNeeded(request);
      if (request.status !== 'OFFERING') {
        throw new ConflictException(`Cannot accept an offer on a request in status ${request.status}`);
      }
      const freshOffer = await this.store.getOffer(offerId);
      if (!freshOffer || freshOffer.status !== 'LIVE') {
        throw new ConflictException(`Cannot accept an offer in status ${freshOffer?.status ?? 'unknown'}`);
      }
      const vehicle = await this.requireEligibleDriver(freshOffer.driverId);
      const { pin, hash } = generatePin();
      let deliveryDetails = null;
      let deliveryOtp: string | null = null;
      let deliveryOtpHash: string | null = null;
      if (request.serviceCode === 'DELIVERY') {
        deliveryDetails = await this.store.getDeliveryRequestDetails(request.id);
        if (deliveryDetails) {
          const otp = generatePin();
          deliveryOtp = otp.pin;
          deliveryOtpHash = otp.hash;
        }
      }
      try {
        const result = await this.store.acceptOfferAtomic({
          requestId: request.id, offerId, customerId,
          driverId: freshOffer.driverId, vehicleId: vehicle.id,
          finalFareMinor: freshOffer.proposedFareMinor,
          paymentMethod: request.paymentMethod, pinHash: hash,
          deliveryDetails, deliveryOtpHash,
        });
        return { ...result, pin, deliveryOtp };
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        if (code === 'REQUEST_NOT_FOUND') throw new NotFoundException('Ride request not found');
        if (code === 'REQUEST_NOT_OFFERING' || code === 'OFFER_NOT_LIVE') {
          throw new ConflictException('This offer can no longer be accepted');
        }
        // PG unique violation on rides.request_id: the second guard
        // firing means another accept already won.
        if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') {
          throw new ConflictException('This offer can no longer be accepted');
        }
        throw e;
      }
    }
    return this.withRequestLock(offer.requestId, async () => {
      let request = await this.loadRequest(offer.requestId);
      if (request.customerId !== customerId) {
        throw new ForbiddenException('Not authorised to accept offers on this ride');
      }
      request = await this.expireIfNeeded(request);
      if (request.status !== 'OFFERING') {
        throw new ConflictException(`Cannot accept an offer on a request in status ${request.status}`);
      }
      const freshOffer = await this.store.getOffer(offerId);
      if (!freshOffer || freshOffer.status !== 'LIVE') {
        throw new ConflictException(`Cannot accept an offer in status ${freshOffer?.status ?? 'unknown'}`);
      }
      const vehicle = await this.requireEligibleDriver(freshOffer.driverId);
      const ride = await this.store.createRide({
        requestId: request.id, customerId: request.customerId, driverId: freshOffer.driverId,
        vehicleId: vehicle.id, status: 'DRIVER_SELECTED', finalFareMinor: freshOffer.proposedFareMinor,
        commissionMinor: null, commissionRuleVersion: null, paymentMethod: request.paymentMethod,
      });
      await this.store.setRideRequestStatus(request.id, 'DRIVER_SELECTED');
      await this.store.addRequestHistory({
        requestId: request.id, fromStatus: 'OFFERING', toStatus: 'DRIVER_SELECTED',
        actorId: customerId, actorRole: 'CUSTOMER', reason: null,
      });
      const allOffers = await this.store.listOffersByRequest(request.id);
      for (const other of allOffers) {
        if (other.id === freshOffer.id) {
          await this.store.setOfferStatus(other.id, 'ACCEPTED');
          await this.store.setDispatchAttemptOutcome(request.id, other.driverId, 'ACCEPTED');
        } else if (other.status === 'LIVE') {
          await this.store.setOfferStatus(other.id, 'SUPERSEDED');
          await this.store.setDispatchAttemptOutcome(request.id, other.driverId, 'SUPERSEDED');
        }
      }
      await this.store.incrementOffersAccepted(freshOffer.driverId);
      // Phase 10: the pickup PIN is issued at accept. Its plaintext is
      // returned here exactly once; only the hash is stored.
      const { pin, hash } = generatePin();
      await this.store.createRidePin({ rideId: ride.id, pinHash: hash, attempts: 0, verifiedAt: null });
      // Phase 11: delivery rides also get their details copied onto the
      // ride and a recipient OTP issued (plaintext returned once).
      let deliveryOtp: string | null = null;
      if (request.serviceCode === 'DELIVERY') {
        const requestDetails = await this.store.getDeliveryRequestDetails(request.id);
        const setup = await this.delivery.onRideAccepted(ride, requestDetails);
        deliveryOtp = setup?.deliveryOtp ?? null;
      }
      return { ride, offer: await this.store.getOffer(offerId), request: await this.store.getRideRequest(request.id), pin, deliveryOtp };
    });
  }

  async listOffers(requestId: string, viewerId: string, isAdmin: boolean) {
    const request = await this.loadRequest(requestId);
    const isCustomer = request.customerId === viewerId;
    if (!isCustomer && !isAdmin) {
      // Drivers see only their own offers; other viewers see nothing.
      const mine = (await this.store.listOffersByRequest(requestId)).filter((o) => o.driverId === viewerId);
      if (mine.length === 0) throw new ForbiddenException('Not authorised to view offers on this ride');
      return this.enrich(mine);
    }
    return this.enrich(await this.store.listOffersByRequest(requestId));
  }

  private async enrich(offers: OfferRecord[]) {
    const out = [];
    for (const offer of offers) {
      const stats = await this.store.getDriverStats(offer.driverId);
      const vehicles = await this.store.listVehiclesByOwner(offer.driverId);
      const active = vehicles.find((v) => v.isActive);
      out.push({
        ...offer,
        driverRating: stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 100) / 100 : null,
        vehicleCategory: active?.categoryCode ?? null,
      });
    }
    return out;
  }

  async incomingRequests(driverId: string) {
    const requests = await this.store.listOpenRequestsForDriver(driverId);
    const out = [];
    for (const request of requests) {
      const offers = await this.store.listOffersByRequest(request.id);
      const myOffer = offers.find((o) => o.driverId === driverId && o.status === 'LIVE') ?? null;
      // Couriers see the package before offering — that is the point
      // of collecting delivery details at request time.
      const deliveryDetails = request.serviceCode === 'DELIVERY'
        ? await this.store.getDeliveryRequestDetails(request.id)
        : null;
      out.push({ ...request, myOffer, deliveryDetails });
    }
    return out;
  }
}
