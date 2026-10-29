import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { STORE } from '../data/store.interface';
import type { RideRecord, Store } from '../data/store.interface';
import { canTransitionRide, type RideStatus } from '@rahi/shared-types';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { generatePin } from './pin';
import { DeliveryService, MAX_DELIVERY_OTP_ATTEMPTS } from '../delivery/delivery.service';
import { PaymentsService } from '../payments/payments.service';
import * as path from 'path';
import { promises as fs } from 'fs';

export const MAX_PIN_ATTEMPTS = 5;

/**
 * Trip lifecycle (Phase 10). Every transition goes through the shared
 * ride state machine, is recorded in ride history, and is broadcast
 * to the ride's Socket.IO room. Cancellation rules come straight from
 * the machine: customers and drivers can cancel only before the trip
 * starts; only an admin can cancel a trip in progress.
 */
@Injectable()
export class TripsService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    private readonly gateway: TrackingGateway,
    private readonly delivery: DeliveryService,
    private readonly payments: PaymentsService,
  ) {}

  private noShowWaitMs(): number {
    return Number(process.env.NO_SHOW_WAIT_MINUTES ?? 5) * 60 * 1000;
  }

  async loadRide(rideId: string) {
    const ride = await this.store.getRideById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  assertParticipant(ride: RideRecord, userId: string, isAdmin: boolean) {
    if (ride.customerId !== userId && ride.driverId !== userId && !isAdmin) {
      throw new ForbiddenException('Not a participant of this ride');
    }
  }

  private async transition(
    ride: RideRecord, to: RideStatus, actorId: string, actorRole: string, reason: string | null,
  ) {
    const from = ride.status as RideStatus;
    if (!canTransitionRide(from, to)) {
      throw new ConflictException(`Cannot move a ride from ${from} to ${to}`);
    }
    await this.store.setRideStatus(ride.id, to);
    await this.store.addRideHistory({
      rideId: ride.id, fromStatus: from, toStatus: to, actorId, actorRole, reason,
    });
    // The request mirrors the ride until completion/cancellation.
    if (to === 'COMPLETED' || to.startsWith('CANCELLED')) {
      await this.store.setRideRequestStatus(ride.requestId, to);
      await this.store.addRequestHistory({
        requestId: ride.requestId, fromStatus: 'DRIVER_SELECTED', toStatus: to,
        actorId, actorRole, reason,
      });
    }
    this.gateway.emitToRide(ride.id, 'rideStatus', { rideId: ride.id, from, to, actorRole, reason });
    // Delivery mirroring happens only after the ride transition
    // succeeds, so delivery can never run ahead of the ride.
    await this.delivery.onTripEvent({ ...ride, status: to }, to, actorId, actorRole);
    return this.store.getRideById(ride.id);
  }

  private requireDriver(ride: RideRecord, userId: string) {
    if (ride.driverId !== userId) throw new ForbiddenException('Only the assigned driver can do this');
  }

  async enRoute(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    return this.transition(ride, 'DRIVER_EN_ROUTE', driverId, 'DRIVER', null);
  }

  async arrived(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    return this.transition(ride, 'DRIVER_ARRIVED', driverId, 'DRIVER', null);
  }

  async beginPinVerification(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    return this.transition(ride, 'WAITING_FOR_PIN', driverId, 'DRIVER', null);
  }

  async verifyPin(driverId: string, rideId: string, pin: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    if (ride.status !== 'WAITING_FOR_PIN') {
      throw new ConflictException(`PIN can only be verified while waiting for it (currently ${ride.status})`);
    }
    const record = await this.store.getRidePin(rideId);
    if (!record) throw new NotFoundException('No PIN was issued for this ride');
    if (record.verifiedAt) throw new ConflictException('PIN was already verified');
    if (record.attempts >= MAX_PIN_ATTEMPTS) {
      throw new ForbiddenException('PIN verification is locked after too many failed attempts; the customer can regenerate the PIN');
    }
    const matches = bcrypt.compareSync(pin, record.pinHash);
    if (!matches) {
      await this.store.incrementPinAttempts(rideId);
      throw new UnauthorizedException('Incorrect PIN');
    }
    await this.store.setPinVerified(rideId);
    return this.transition(ride, 'IN_PROGRESS', driverId, 'DRIVER', null);
  }

  async regeneratePin(customerId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    if (ride.customerId !== customerId) {
      throw new ForbiddenException('Only the customer can regenerate the PIN');
    }
    if (ride.status === 'IN_PROGRESS' || ride.status === 'COMPLETED' || ride.status.startsWith('CANCELLED')) {
      throw new ConflictException(`PIN cannot be regenerated in status ${ride.status}`);
    }
    const { pin, hash } = generatePin();
    await this.store.createRidePin({ rideId, pinHash: hash, attempts: 0, verifiedAt: null });
    return { pin, rideId };
  }

  async complete(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    // Delivery rides complete only via recipient OTP proof, never via
    // this endpoint — otherwise a courier could complete without proof.
    const request = await this.store.getRideRequest(ride.requestId);
    if (request?.serviceCode === 'DELIVERY') {
      throw new ConflictException('Delivery rides complete via recipient OTP verification, not this endpoint');
    }
    const completed = await this.transition(ride, 'COMPLETED', driverId, 'DRIVER', null);
    const stats = await this.store.getDriverStats(driverId);
    await this.store.setDriverStats({ ...stats, tripsToday: stats.tripsToday + 1 });
    // Phase 12: settlement runs right after completion; a wallet
    // shortfall leaves the trip completed and the payment FAILED for
    // a later retry — it never rolls the trip back.
    await this.payments.settleRideBestEffort(ride.id);
    return completed;
  }

  async cancel(userId: string, rideId: string, role: 'CUSTOMER' | 'DRIVER' | 'ADMIN', reason: string | null) {
    const ride = await this.loadRide(rideId);
    if (role === 'CUSTOMER' && ride.customerId !== userId) {
      throw new ForbiddenException('Only the customer can cancel as customer');
    }
    if (role === 'DRIVER') {
      this.requireDriver(ride, userId);
      if (!reason || reason.trim().length < 3) {
        throw new BadRequestException('A reason is required for driver cancellation');
      }
    }
    const to: RideStatus = role === 'CUSTOMER'
      ? 'CANCELLED_BY_CUSTOMER'
      : role === 'DRIVER' ? 'CANCELLED_BY_DRIVER' : 'CANCELLED_BY_ADMIN';
    const cancelled = await this.transition(ride, to, userId, role, reason);
    // Phase 12: matched-ride cancellation fee (default 0 in pilot).
    await this.payments.chargeCancellationFeeBestEffort(ride.id, role, userId);
    return cancelled;
  }

  /** No-show: driver waited for the customer after arriving. The wait
   *  is measured from the DRIVER_ARRIVED history entry, so a driver
   *  cannot claim no-show the instant they arrive. */
  async noShow(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    if (ride.status !== 'DRIVER_ARRIVED' && ride.status !== 'WAITING_FOR_PIN') {
      throw new ConflictException(`No-show can only be claimed after arriving (currently ${ride.status})`);
    }
    const history = await this.store.listRideHistory(rideId);
    const arrivedAt = history.find((h) => h.toStatus === 'DRIVER_ARRIVED')?.createdAt;
    if (!arrivedAt) throw new ConflictException('No arrival was recorded for this ride');
    if (Date.now() - arrivedAt.getTime() < this.noShowWaitMs()) {
      throw new ConflictException(`No-show requires waiting ${this.noShowWaitMs() / 60000} minutes after arrival`);
    }
    return this.transition(ride, 'CANCELLED_BY_DRIVER', driverId, 'DRIVER', 'NO_SHOW');
  }

  // ---- Delivery (Phase 11; delivery state itself lives in DeliveryService) ----
  async getDelivery(rideId: string, userId: string, isAdmin: boolean) {
    const ride = await this.loadRide(rideId);
    this.assertParticipant(ride, userId, isAdmin);
    return this.delivery.getDelivery(rideId);
  }

  async arrivedAtRecipient(driverId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) throw new NotFoundException('No delivery details for this ride');
    if (details.status !== 'IN_TRANSIT') {
      throw new ConflictException(`Cannot arrive at the recipient from delivery status ${details.status}`);
    }
    return this.delivery.setStatus(rideId, 'ARRIVED', driverId, 'DRIVER', null);
  }

  async verifyDeliveryOtp(driverId: string, rideId: string, otp: string) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) throw new NotFoundException('No delivery details for this ride');
    if (details.status !== 'ARRIVED') {
      throw new ConflictException(`Delivery OTP can only be verified after arriving at the recipient (currently ${details.status})`);
    }
    const proof = await this.store.getDeliveryOtpProof(rideId);
    if (!proof || !proof.otpHash) throw new NotFoundException('No delivery OTP was issued for this ride');
    if (proof.verifiedBy) throw new ConflictException('Delivery OTP was already verified');
    if (proof.attempts >= MAX_DELIVERY_OTP_ATTEMPTS) {
      throw new ForbiddenException('Delivery OTP verification is locked after too many failed attempts; the customer can regenerate the OTP');
    }
    if (!bcrypt.compareSync(otp, proof.otpHash)) {
      await this.store.incrementDeliveryProofAttempts(proof.id);
      throw new UnauthorizedException('Incorrect delivery OTP');
    }
    await this.store.setDeliveryProofVerified(proof.id, driverId);
    await this.delivery.setStatus(rideId, 'DELIVERED', driverId, 'DRIVER', null);
    // Delivery proof completes the ride (the /complete endpoint refuses
    // delivery rides precisely so this is the only completion path).
    const completed = await this.transition(ride, 'COMPLETED', driverId, 'DRIVER', null);
    const stats = await this.store.getDriverStats(driverId);
    await this.store.setDriverStats({ ...stats, tripsToday: stats.tripsToday + 1 });
    // Phase 12: settlement runs right after completion; a wallet
    // shortfall leaves the trip completed and the payment FAILED for
    // a later retry — it never rolls the trip back.
    await this.payments.settleRideBestEffort(ride.id);
    return completed;
  }

  async regenerateDeliveryOtp(customerId: string, rideId: string) {
    const ride = await this.loadRide(rideId);
    if (ride.customerId !== customerId) {
      throw new ForbiddenException('Only the customer can regenerate the delivery OTP');
    }
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) throw new NotFoundException('No delivery details for this ride');
    if (details.status === 'DELIVERED' || details.status.startsWith('CANCELLED')) {
      throw new ConflictException(`Delivery OTP cannot be regenerated in status ${details.status}`);
    }
    return this.delivery.regenerateOtp(rideId);
  }

  async addDeliveryPhoto(
    driverId: string, rideId: string,
    file: { buffer: Buffer; mimeType: string; originalName: string },
  ) {
    const ride = await this.loadRide(rideId);
    this.requireDriver(ride, driverId);
    const details = await this.store.getDeliveryDetails(rideId);
    if (!details) throw new NotFoundException('No delivery details for this ride');
    if (details.status === 'DELIVERED' || details.status.startsWith('CANCELLED')) {
      throw new ConflictException(`Photos cannot be added in delivery status ${details.status}`);
    }
    const extension = file.originalName.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png'].includes(extension ?? '')) {
      throw new BadRequestException('Delivery photos must be jpg or png');
    }
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Delivery photo exceeds the 10 MB limit');
    }
    const dir = path.join(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads'), 'delivery-photos');
    await fs.mkdir(dir, { recursive: true });
    const key = `${rideId}-${Date.now()}.${extension}`;
    await fs.writeFile(path.join(dir, key), file.buffer);
    // Photos are evidence, not a status transition: the delivery
    // status does not move when a photo is added.
    const proof = await this.store.createDeliveryProof({
      rideId, proofType: 'PHOTO', storageKey: key, otpHash: null, verifiedBy: driverId, attempts: 0,
    });
    return { id: proof.id, proofType: 'PHOTO', createdAt: proof.createdAt };
  }

  async downloadDeliveryPhoto(rideId: string, proofId: string, userId: string, isAdmin: boolean) {
    const ride = await this.loadRide(rideId);
    this.assertParticipant(ride, userId, isAdmin);
    const proof = await this.store.getDeliveryProofById(proofId);
    if (!proof || proof.rideId !== rideId || proof.proofType !== 'PHOTO' || !proof.storageKey) {
      throw new NotFoundException('Delivery photo not found');
    }
    const dir = path.join(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads'), 'delivery-photos');
    return { path: path.join(dir, proof.storageKey), storageKey: proof.storageKey };
  }

  async getTrip(rideId: string, userId: string, isAdmin: boolean) {
    const ride = await this.loadRide(rideId);
    this.assertParticipant(ride, userId, isAdmin);
    const request = await this.store.getRideRequest(ride.requestId);
    const latestLocation = await this.store.getLatestRideLocation(rideId);
    const timeline = await this.store.listRideHistory(rideId);
    const pin = await this.store.getRidePin(rideId);
    const delivery = request?.serviceCode === 'DELIVERY'
      ? await this.delivery.getDelivery(rideId).catch(() => null)
      : null;
    return {
      ride, request, latestLocation, timeline, delivery,
      pinIssued: pin !== null, pinVerified: pin?.verifiedAt !== null,
    };
  }
}
