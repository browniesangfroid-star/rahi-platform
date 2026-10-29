import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { LOCATION_INDEX } from './location-index';
import type { LocationIndex } from './location-index';

export interface DispatchCandidate {
  driverUserId: string;
  distanceKm: number;
  score: number;
  rating: number;
  acceptanceRate: number;
  tripsToday: number;
}

export interface DispatchRound {
  requestId: string;
  radiusKm: number;
  candidates: DispatchCandidate[];
  outcome: 'OFFERING' | 'NO_DRIVER_FOUND' | 'ALREADY_DISPATCHED';
}

export const DISPATCH_RADII_KM = [2, 4, 7, 10];
export const DISPATCH_BATCH_SIZE = 10;

/**
 * DispatchService (Phase 7). Hard filters first, then a documented,
 * non-black-box score. No driver is selected here — Phase 8 turns a
 * round's candidates into offers and handles accept/counter/decline.
 *
 * Score (weights from ARCHITECTURE.md):
 *   score = 0.45 * (1 - distanceKm / maxRadiusKm)
 *         + 0.20 * (rating / 5)
 *         + 0.20 * acceptanceRate
 *         + 0.15 * fairness, where fairness =
 *           1 - (driver trips in this city today / max trips in this
 *           city today), clamped to [0, 1]; 1 when nobody has run a
 *           trip in the city today. Phase 15 closed the Phase 7
 *           deviation: fairness now reads the city aggregates from
 *           the store instead of 1/(1+tripsToday).
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(LOCATION_INDEX) private readonly index: LocationIndex,
  ) {}

  scoreCandidate(distanceKm: number, maxRadiusKm: number, rating: number, acceptanceRate: number, tripsInCityToday: number, cityMaxTripsToday: number): number {
    const distancePart = 0.45 * (1 - distanceKm / maxRadiusKm);
    const ratingPart = 0.20 * (rating / 5);
    const acceptancePart = 0.20 * acceptanceRate;
    const fairness = cityMaxTripsToday > 0
      ? Math.min(1, Math.max(0, 1 - tripsInCityToday / cityMaxTripsToday))
      : 1;
    const fairnessPart = 0.15 * fairness;
    return Math.round((distancePart + ratingPart + acceptancePart + fairnessPart) * 10000) / 10000;
  }

  async dispatch(requestId: string): Promise<DispatchRound> {
    const request = await this.store.getRideRequest(requestId);
    if (!request) throw new NotFoundException('Ride request not found');
    if (request.status === 'NO_DRIVER_FOUND' || request.status === 'CANCELLED_BY_CUSTOMER') {
      return { requestId, radiusKm: 0, candidates: [], outcome: request.status === 'NO_DRIVER_FOUND' ? 'NO_DRIVER_FOUND' : 'ALREADY_DISPATCHED' };
    }
    // Idempotent re-dispatch: an OFFERING request with attempts already
    // recorded returns its last round instead of duplicating attempts.
    const existingAttempts = await this.store.listDispatchAttempts(requestId);
    if (request.status === 'OFFERING' && existingAttempts.length > 0) {
      const lastRadius = existingAttempts[existingAttempts.length - 1].radiusKm;
      const candidates = existingAttempts
        .filter((a) => a.radiusKm === lastRadius)
        .map((a) => ({
          driverUserId: a.driverUserId, distanceKm: a.distanceKm, score: a.score,
          rating: 0, acceptanceRate: 0, tripsToday: 0,
        }));
      return { requestId, radiusKm: lastRadius, candidates, outcome: 'ALREADY_DISPATCHED' };
    }
    if (request.status !== 'SEARCHING') {
      return { requestId, radiusKm: 0, candidates: [], outcome: 'ALREADY_DISPATCHED' };
    }
    if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
      await this.transition(requestId, 'SEARCHING', 'EXPIRED');
      return { requestId, radiusKm: 0, candidates: [], outcome: 'NO_DRIVER_FOUND' };
    }
    await this.transition(requestId, 'SEARCHING', 'OFFERING');
    const declined = new Set(await this.store.getDeclinedDriverIds(requestId));
    // City-day fairness inputs, fetched once per dispatch (not per
    // candidate): the busiest driver in this city today sets the bar.
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const fairness = request.cityId
      ? await this.store.getCityFairness(request.cityId, dayStart)
      : { cityId: '', cityMaxTripsToday: 0, drivers: [] as { driverUserId: string; tripsToday: number }[] };
    const tripsInCity = (driverId: string) =>
      fairness.drivers.find((d) => d.driverUserId === driverId)?.tripsToday ?? 0;

    for (const radiusKm of DISPATCH_RADII_KM) {
      const nearby = await this.index.nearby(request.cityId, request.pickupLat, request.pickupLng, radiusKm, request.categoryCode);
      const candidates: DispatchCandidate[] = [];
      for (const driver of nearby) {
        if (declined.has(driver.driverId)) continue;
        // Hard filters that the index cannot guarantee: KYC + active
        // approved vehicle are checked against the store, not trusted
        // from index metadata.
        const profile = await this.store.getDriverProfile(driver.driverId);
        if (!profile || profile.kycStatus !== 'APPROVED') continue;
        const vehicles = await this.store.listVehiclesByOwner(driver.driverId);
        const activeApproved = vehicles.some((v) => v.isActive && v.approvalStatus === 'APPROVED');
        if (!activeApproved) continue;
        if (request.categoryCode) {
          const active = vehicles.find((v) => v.isActive);
          if (active && active.categoryCode !== request.categoryCode) continue;
        }
        const stats = await this.store.getDriverStats(driver.driverId);
        const rating = stats.ratingCount > 0 ? stats.ratingSum / stats.ratingCount : 5.0;
        const acceptanceRate = stats.offersSent > 0 ? stats.offersAccepted / stats.offersSent : 0.5;
        const cityTrips = tripsInCity(driver.driverId);
        const score = this.scoreCandidate(driver.distanceKm, radiusKm, rating, acceptanceRate, cityTrips, fairness.cityMaxTripsToday);
        candidates.push({
          driverUserId: driver.driverId, distanceKm: Math.round(driver.distanceKm * 1000) / 1000,
          score, rating: Math.round(rating * 100) / 100, acceptanceRate, tripsToday: cityTrips,
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      const batch = candidates.slice(0, DISPATCH_BATCH_SIZE);
      if (batch.length === 0) continue;
      for (const candidate of batch) {
        await this.store.addDispatchAttempt({
          requestId, driverUserId: candidate.driverUserId, radiusKm,
          score: candidate.score, distanceKm: candidate.distanceKm, outcome: 'OFFERED',
          createdAt: new Date(),
        });
        await this.store.incrementOfferSent(candidate.driverUserId);
      }
      return { requestId, radiusKm, candidates: batch, outcome: 'OFFERING' };
    }

    await this.transition(requestId, 'OFFERING', 'NO_DRIVER_FOUND');
    return { requestId, radiusKm: 0, candidates: [], outcome: 'NO_DRIVER_FOUND' };
  }

  private async transition(requestId: string, from: string, to: string) {
    await this.store.setRideRequestStatus(requestId, to);
    await this.store.addRequestHistory({
      requestId, fromStatus: from, toStatus: to, actorId: null, actorRole: 'SYSTEM', reason: null,
    });
  }
}
