import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { DeliveryRequestDetails, RideRecord, Store } from '../data/store.interface';
import { canTransitionDelivery, type DeliveryStatus } from '@rahi/shared-types';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { generatePin } from '../trips/pin';

export const MAX_DELIVERY_OTP_ATTEMPTS = 5;

/**
 * Delivery state owner (Phase 11). The ride machine (Phase 10) and
 * the delivery machine run in parallel for DELIVERY rides; TripsService
 * calls here to mirror trip events onto delivery status, and this
 * service never moves ride status itself — that keeps one owner per
 * machine. OTP hashes are never returned to any caller.
 */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    private readonly gateway: TrackingGateway,
  ) {}

  /** Called at accept: copies request-time details onto the ride and
   *  issues the recipient OTP. Returns the OTP plaintext exactly once
   *  (the customer shares it with the recipient out of band). */
  async onRideAccepted(ride: RideRecord, requestDetails: DeliveryRequestDetails | null) {
    if (!requestDetails) return null;
    await this.store.createDeliveryDetails({
      ...requestDetails,
      rideId: ride.id, status: 'COURIER_SELECTED', photoStorageKey: null,
    });
    await this.store.addDeliveryHistory({
      rideId: ride.id, fromStatus: null, toStatus: 'COURIER_SELECTED',
      actorId: ride.customerId, actorRole: 'CUSTOMER', reason: null,
    });
    const { pin: deliveryOtp, hash } = generatePin();
    await this.store.createDeliveryProof({
      rideId: ride.id, proofType: 'OTP', storageKey: null, otpHash: hash,
      verifiedBy: null, attempts: 0,
    });
    return { deliveryOtp };
  }

  async setStatus(rideId: string, to: DeliveryStatus, actorId: string | null, actorRole: string | null, reason: string | null) {
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) return null;
    const from = details.status as DeliveryStatus;
    if (from === to) return details;
    if (!canTransitionDelivery(from, to)) {
      throw new ConflictException(`Cannot move delivery from ${from} to ${to}`);
    }
    await this.store.setDeliveryStatus(rideId, to);
    await this.store.addDeliveryHistory({ rideId, fromStatus: from, toStatus: to, actorId, actorRole, reason });
    this.gateway.emitToRide(rideId, 'deliveryStatus', { rideId, from, to, actorRole, reason });
    return this.store.getDeliveryDetails(rideId);
  }

  /** Mirrors trip events onto delivery status. Called by TripsService
   *  after its own transition succeeds, so a failed trip transition
   *  never leaves delivery ahead of the ride. */
  async onTripEvent(ride: RideRecord, tripTo: string, actorId: string, actorRole: string) {
    const details = await this.store.getDeliveryDetails(ride.id);
    if (!details) return;
    if (tripTo === 'DRIVER_EN_ROUTE') {
      await this.setStatus(ride.id, 'COURIER_EN_ROUTE_PICKUP', actorId, actorRole, null);
    } else if (tripTo === 'IN_PROGRESS') {
      // PIN verified at the sender = package picked up, courier now
      // in transit. Both steps are recorded, even though PICKED_UP
      // is transient here (the PIN is the pickup proof).
      await this.setStatus(ride.id, 'PICKED_UP', actorId, actorRole, null);
      await this.setStatus(ride.id, 'IN_TRANSIT', actorId, actorRole, null);
    } else if (tripTo.startsWith('CANCELLED')) {
      const cancelled = tripTo === 'CANCELLED_BY_CUSTOMER'
        ? 'CANCELLED_BY_CUSTOMER'
        : tripTo === 'CANCELLED_BY_DRIVER' ? 'CANCELLED_BY_COURIER' : 'CANCELLED_BY_ADMIN';
      await this.setStatus(ride.id, cancelled as DeliveryStatus, actorId, actorRole, null);
    }
  }

  async getDelivery(rideId: string) {
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) throw new NotFoundException('No delivery details for this ride');
    const proofs = await this.store.listDeliveryProofs(rideId);
    const history = await this.store.listDeliveryHistory(rideId);
    return {
      details,
      history,
      proofs: proofs.map((p) => ({
        id: p.id, proofType: p.proofType, verifiedBy: p.verifiedBy, createdAt: p.createdAt,
        hasPhoto: p.storageKey !== null,
      })),
    };
  }

  async regenerateOtp(rideId: string) {
    // A new proof row replaces the old OTP (getDeliveryOtpProof always
    // reads the latest); the old hash is never reused, and attempts
    // reset because this is a fresh code.
    const { pin: deliveryOtp, hash } = generatePin();
    await this.store.createDeliveryProof({
      rideId, proofType: 'OTP', storageKey: null, otpHash: hash, verifiedBy: null, attempts: 0,
    });
    return { deliveryOtp };
  }
}
