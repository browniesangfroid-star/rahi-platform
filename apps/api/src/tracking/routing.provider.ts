export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** Ordered [lng, lat] points, if the provider returns a geometry. */
  points: Array<[number, number]>;
  provider: string;
}

export const ROUTING_PROVIDER = 'ROUTING_PROVIDER';

/**
 * Routing abstraction. The default is haversine (no external call,
 * deterministic, works offline). OSRM is selected with
 * MAPS_PROVIDER=osrm and OSRM_BASE_URL; it falls back to haversine
 * on any failure rather than failing the request, and the fallback
 * is reported in the result's provider field so callers never mistake
 * a straight-line estimate for a road route.
 */
export interface RoutingProvider {
  route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteResult>;
}
