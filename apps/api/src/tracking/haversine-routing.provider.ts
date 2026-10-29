import { haversineKm, etaMinutes } from '../rides/geo';
import type { RouteResult, RoutingProvider } from './routing.provider';

export class HaversineRoutingProvider implements RoutingProvider {
  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteResult> {
    const distanceKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
    return {
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      durationMin: etaMinutes(distanceKm, 'CAR'),
      points: [[from.lng, from.lat], [to.lng, to.lat]],
      provider: 'haversine',
    };
  }
}
