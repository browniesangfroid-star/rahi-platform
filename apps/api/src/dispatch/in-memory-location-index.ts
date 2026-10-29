import { haversineKm } from '../rides/geo';
import type { DriverLocation, LocationIndex, NearbyDriver } from './location-index';

/** Freshness window: a driver with no update in 60s is not matchable,
 *  even if the app still says online. Configurable in Phase 16. */
export const GPS_FRESHNESS_MS = 60_000;

export class InMemoryLocationIndex implements LocationIndex {
  drivers = new Map<string, DriverLocation>();

  async setDriver(driver: DriverLocation) {
    this.drivers.set(driver.driverId, { ...driver, lastSeen: new Date(driver.lastSeen) });
  }
  async setOnline(driverId: string, online: boolean) {
    const driver = this.drivers.get(driverId);
    if (driver) driver.online = online;
  }
  async getDriver(driverId: string) {
    return this.drivers.get(driverId) ?? null;
  }
  async nearby(cityId: string | null, lat: number, lng: number, radiusKm: number, categoryCode: string | null) {
    const now = Date.now();
    const out: NearbyDriver[] = [];
    for (const driver of this.drivers.values()) {
      if (!driver.online) continue;
      if (cityId && driver.cityId && driver.cityId !== cityId) continue;
      if (categoryCode && driver.categoryCode !== categoryCode) continue;
      if (now - driver.lastSeen.getTime() > GPS_FRESHNESS_MS) continue;
      const distanceKm = haversineKm(lat, lng, driver.lat, driver.lng);
      if (distanceKm <= radiusKm) out.push({ ...driver, distanceKm });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return out;
  }
  async listOnline(cityId: string | null) {
    return [...this.drivers.values()].filter((d) => d.online && (!cityId || !d.cityId || d.cityId === cityId));
  }
}
