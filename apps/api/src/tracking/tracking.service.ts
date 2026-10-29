import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { RideRecord, Store } from '../data/store.interface';
import { LOCATION_INDEX } from '../dispatch/location-index';
import type { LocationIndex } from '../dispatch/location-index';
import { ROUTING_PROVIDER } from './routing.provider';
import type { RoutingProvider } from './routing.provider';

export const LIVE_RIDE_STATUSES = new Set([
  'DRIVER_SELECTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'WAITING_FOR_PIN', 'IN_PROGRESS',
]);

/**
 * Live tracking (Phase 9). The driver is the only writer of a ride's
 * location; the customer (or an admin) is the reader. ETA target
 * follows the trip: pickup until the ride is in progress, destination
 * once it is. Location is persisted (ride_locations) AND pushed to
 * the driver's index entry, so dispatch freshness stays current
 * during a ride.
 */
@Injectable()
export class TrackingService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(LOCATION_INDEX) private readonly index: LocationIndex,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
  ) {}

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

  async reportLocation(driverId: string, rideId: string, lat: number, lng: number) {
    const ride = await this.loadRide(rideId);
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('Only the assigned driver can report this ride\'s location');
    }
    if (!LIVE_RIDE_STATUSES.has(ride.status)) {
      throw new ConflictException(`Ride in status ${ride.status} is not being tracked`);
    }
    const request = await this.store.getRideRequest(ride.requestId);
    if (!request) throw new NotFoundException('Ride request not found');
    const location = await this.store.addRideLocation({ rideId, lat, lng });
    // Keep the dispatch index warm: the same driver entry, new position.
    const existing = await this.index.getDriver(driverId);
    if (existing) {
      await this.index.setDriver({ ...existing, lat, lng, lastSeen: new Date() });
    }
    const target = ride.status === 'IN_PROGRESS'
      ? { lat: request.destinationLat, lng: request.destinationLng, label: 'destination' }
      : { lat: request.pickupLat, lng: request.pickupLng, label: 'pickup' };
    const route = await this.routing.route({ lat, lng }, { lat: target.lat, lng: target.lng });
    return {
      rideId, driverId, lat, lng, recordedAt: location.recordedAt,
      etaMin: route.durationMin, distanceKm: route.distanceKm,
      etaTarget: target.label, routeProvider: route.provider,
      routePoints: route.points,
    };
  }

  async latestLocation(rideId: string, userId: string, isAdmin: boolean) {
    const ride = await this.loadRide(rideId);
    this.assertParticipant(ride, userId, isAdmin);
    const location = await this.store.getLatestRideLocation(rideId);
    if (!location) return { rideId, location: null, etaMin: null, distanceKm: null, etaTarget: null };
    const request = await this.store.getRideRequest(ride.requestId);
    if (!request) throw new NotFoundException('Ride request not found');
    const target = ride.status === 'IN_PROGRESS'
      ? { lat: request.destinationLat, lng: request.destinationLng, label: 'destination' }
      : { lat: request.pickupLat, lng: request.pickupLng, label: 'pickup' };
    const route = await this.routing.route(
      { lat: location.lat, lng: location.lng }, { lat: target.lat, lng: target.lng },
    );
    return {
      rideId, location, etaMin: route.durationMin, distanceKm: route.distanceKm,
      etaTarget: target.label, routeProvider: route.provider, routePoints: route.points,
    };
  }

  async routeForRide(rideId: string, userId: string, isAdmin: boolean) {
    const latest = await this.latestLocation(rideId, userId, isAdmin);
    const ride = await this.loadRide(rideId);
    const request = await this.store.getRideRequest(ride.requestId);
    if (!request) throw new NotFoundException('Ride request not found');
    return {
      rideId, status: ride.status,
      driver: latest.location,
      pickup: { lat: request.pickupLat, lng: request.pickupLng },
      destination: { lat: request.destinationLat, lng: request.destinationLng },
      etaMin: latest.etaMin, distanceKm: latest.distanceKm,
      etaTarget: latest.etaTarget, routeProvider: latest.routeProvider,
      routePoints: latest.routePoints ?? [],
    };
  }
}
