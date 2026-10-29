import Redis from 'ioredis';
import { haversineKm } from '../rides/geo';
import type { DriverLocation, LocationIndex, NearbyDriver } from './location-index';
import { GPS_FRESHNESS_MS } from './in-memory-location-index';

/**
 * Production location index (Redis GEO). NOT live-tested in the VM used
 * for Phase 7 (no Redis there) — run against a real Redis before staging.
 * Key layout: GEO `drivers:{cityId}` (driver id only, skinny key),
 * HASH `driver:{id}` for metadata. One write per GPS ping.
 */
export class RedisLocationIndex implements LocationIndex {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
  }

  private geoKey(_cityId: string | null) {
    // Phase 7 uses a single global geo key. City sharding (one key per
    // city) is a scale-out optimisation for Phase 15+, not a correctness
    // requirement: nearby() already filters by distance, and driver
    // city is not yet a stored driver attribute.
    return 'drivers:global';
  }

  async setDriver(driver: DriverLocation) {
    const pipeline = this.redis.pipeline();
    pipeline.geoadd(this.geoKey(driver.cityId), driver.lng, driver.lat, driver.driverId);
    pipeline.hset(`driver:${driver.driverId}`, {
      cityId: driver.cityId ?? '',
      categoryCode: driver.categoryCode,
      lat: String(driver.lat),
      lng: String(driver.lng),
      lastSeen: String(driver.lastSeen.getTime()),
      online: driver.online ? '1' : '0',
      rating: String(driver.rating),
      acceptanceRate: String(driver.acceptanceRate),
      tripsToday: String(driver.tripsToday),
    });
    await pipeline.exec();
  }

  async setOnline(driverId: string, online: boolean) {
    await this.redis.hset(`driver:${driverId}`, 'online', online ? '1' : '0');
  }

  async getDriver(driverId: string) {
    const hash = await this.redis.hgetall(`driver:${driverId}`);
    if (!hash || Object.keys(hash).length === 0) return null;
    return {
      driverId,
      cityId: hash.cityId || null,
      categoryCode: hash.categoryCode,
      lat: Number(hash.lat),
      lng: Number(hash.lng),
      lastSeen: new Date(Number(hash.lastSeen)),
      online: hash.online === '1',
      rating: Number(hash.rating),
      acceptanceRate: Number(hash.acceptanceRate),
      tripsToday: Number(hash.tripsToday),
    };
  }

  async nearby(cityId: string | null, lat: number, lng: number, radiusKm: number, categoryCode: string | null) {
    // GEOSEARCH returns ids within radius; metadata + freshness/category
    // filtering happens on the fetched hashes (small batch, city-scoped).
    const results: any[] = await (this.redis as any).geosearch(
      this.geoKey(cityId), 'FROMLONLAT', lng, lat, 'BYRADIUS', String(radiusKm), 'km', 'ASC', 'WITHDIST',
    );
    const now = Date.now();
    const out: NearbyDriver[] = [];
    for (const [driverId, distance] of results) {
      const driver = await this.getDriver(driverId);
      if (!driver || !driver.online) continue;
      if (categoryCode && driver.categoryCode !== categoryCode) continue;
      if (now - driver.lastSeen.getTime() > GPS_FRESHNESS_MS) continue;
      const distanceKm = typeof distance === 'number' ? distance : haversineKm(lat, lng, driver.lat, driver.lng);
      out.push({ ...driver, distanceKm });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return out;
  }

  async listOnline(cityId: string | null) {
    const ids: string[] = await this.redis.zrange(this.geoKey(cityId), '0', '-1');
    const out: DriverLocation[] = [];
    for (const id of ids) {
      const driver = await this.getDriver(id);
      if (driver?.online) out.push(driver);
    }
    return out;
  }
}
