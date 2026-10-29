export interface DriverLocation {
  driverId: string;
  cityId: string | null;
  categoryCode: string;
  lat: number;
  lng: number;
  lastSeen: Date;
  online: boolean;
  rating: number;
  acceptanceRate: number;
  tripsToday: number;
}

export interface NearbyDriver extends DriverLocation {
  distanceKm: number;
}

export const LOCATION_INDEX = 'LOCATION_INDEX';

/**
 * Hot location index. In-memory for tests/dev, Redis GEO for production
 * (see redis-location-index.ts). The database is never queried for
 * matching — only this index, with freshness and category filters.
 */
export interface LocationIndex {
  setDriver(driver: DriverLocation): Promise<void>;
  setOnline(driverId: string, online: boolean): Promise<void>;
  getDriver(driverId: string): Promise<DriverLocation | null>;
  nearby(cityId: string | null, lat: number, lng: number, radiusKm: number, categoryCode: string | null): Promise<NearbyDriver[]>;
  listOnline(cityId: string | null): Promise<DriverLocation[]>;
}
