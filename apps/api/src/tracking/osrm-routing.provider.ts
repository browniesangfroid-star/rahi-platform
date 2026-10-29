import { HaversineRoutingProvider } from './haversine-routing.provider';
import type { RouteResult, RoutingProvider } from './routing.provider';

/**
 * OSRM road routing. The public demo server (router.project-osrm.org)
 * is DEV ONLY — it is a shared demo, not a production dependency.
 * Production must run its own OSRM instance and point OSRM_BASE_URL
 * at it (Phase 17 deployment notes). Any failure (network, timeout,
 * non-200, bad payload) falls back to haversine and says so.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  private readonly fallback = new HaversineRoutingProvider();
  constructor(private readonly baseUrl: string) {}

  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteResult> {
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`OSRM ${response.status}`);
      const body: any = await response.json();
      const route = body?.routes?.[0];
      if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
        throw new Error('OSRM response has no route');
      }
      const points: Array<[number, number]> = route.geometry?.coordinates ?? [[from.lng, from.lat], [to.lng, to.lat]];
      return {
        distanceKm: Math.round((route.distance / 1000) * 1000) / 1000,
        durationMin: Math.ceil(route.duration / 60),
        points,
        provider: 'osrm',
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[tracking] OSRM failed, falling back to haversine:', (error as Error).message);
      const fallback = await this.fallback.route(from, to);
      return { ...fallback, provider: 'osrm-fallback-haversine' };
    }
  }
}
