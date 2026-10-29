import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { CityRecord, PricingRuleRecord, Store } from '../data/store.interface';
import { ROUTING_PROVIDER } from '../tracking/routing.provider';
import type { RoutingProvider } from '../tracking/routing.provider';
import { etaMinutes, haversineKm } from './geo';

export interface Point { lat: number; lng: number; }
export interface EstimateResult {
  cityId: string;
  cityName: string;
  distanceKm: number;
  durationMin: number;
  suggestedFareMinor: number;
  currency: string;
  pricingMode: string;
  pricingRuleVersion: number;
  fareBreakdown: {
    baseFareMinor: number;
    distanceFareMinor: number;
    durationFareMinor: number;
    minimumFareMinor: number;
    bookingFeeMinor: number;
    demandMultiplier: number;
  };
}

// Phase 13: the service→category mapping is admin-managed (setting
// 'service_categories', owned by AdminService). These are the defaults
// that apply until an admin first saves a change.
const DEFAULT_SERVICE_CATEGORIES: Record<string, string[]> = {
  CAR: ['CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM'],
  BIKE: ['BIKE'],
  DELIVERY: ['BIKE', 'CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM'],
};

/**
 * Server-side pricing. All maths is integer minor units. Client fares
 * are never trusted; estimate and request both re-run this code.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Optional() @Inject(ROUTING_PROVIDER) private readonly routing?: RoutingProvider,
  ) {}

  async validateServiceCategory(serviceCode: string, categoryCode: string | null) {
    // Activation is real: a deactivated service or category cannot
    // be estimated or requested, whatever the client sends.
    const services = await this.store.listServiceTypes();
    const service = services.find((s) => s.code === serviceCode);
    if (!service) throw new BadRequestException(`Unknown service ${serviceCode}`);
    if (!service.isActive) throw new BadRequestException(`Service ${serviceCode} is not available`);
    const mapping = await this.getServiceCategories();
    const allowed = mapping[serviceCode];
    if (!allowed) throw new BadRequestException(`Unknown service ${serviceCode}`);
    if (categoryCode) {
      if (!allowed.includes(categoryCode)) {
        throw new BadRequestException(`Category ${categoryCode} is not valid for service ${serviceCode}`);
      }
      const categories = await this.store.listVehicleCategories();
      const category = categories.find((c) => c.code === categoryCode);
      if (!category) throw new BadRequestException(`Unknown vehicle category ${categoryCode}`);
      if (!category.isActive) throw new BadRequestException(`Category ${categoryCode} is not available`);
    }
  }

  async getServiceCategories(): Promise<Record<string, string[]>> {
    const raw = await this.store.getSetting('service_categories');
    if (!raw) return DEFAULT_SERVICE_CATEGORIES;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
    } catch {
      // Corrupt setting falls back to defaults, never breaks estimates.
    }
    return DEFAULT_SERVICE_CATEGORIES;
  }

  async resolveCity(pickup: Point): Promise<CityRecord> {
    const cities = await this.store.listCities();
    let best: CityRecord | null = null;
    let bestDistance = Infinity;
    for (const city of cities) {
      // Phase 13: deactivated cities no longer resolve.
      if (!city.isActive) continue;
      if (city.centreLat === null || city.centreLng === null) continue;
      const d = haversineKm(pickup.lat, pickup.lng, city.centreLat, city.centreLng);
      if (d < bestDistance) {
        bestDistance = d;
        best = city;
      }
    }
    if (!best || bestDistance > 50) {
      throw new BadRequestException('Service is not available in this area yet');
    }
    return best;
  }

  async getRule(cityId: string, serviceCode: string): Promise<PricingRuleRecord> {
    const rule = await this.store.getPricingRule(cityId, serviceCode);
    if (!rule) {
      throw new NotFoundException(`Pricing is not configured for this city/service yet`);
    }
    return rule;
  }

  async estimate(pickup: Point, destination: Point, serviceCode: string, categoryCode: string | null): Promise<EstimateResult> {
    await this.validateServiceCategory(serviceCode, categoryCode);
    const city = await this.resolveCity(pickup);
    const rule = await this.getRule(city.id, serviceCode);
    // Phase 9: road routing replaces haversine when MAPS_PROVIDER=osrm.
    // On the haversine default the numbers are unchanged from Phase 6:
    // distance is haversine and duration uses the service's speed.
    let distanceKm = haversineKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
    let durationMin = etaMinutes(distanceKm, serviceCode);
    if (this.routing) {
      try {
        const route = await this.routing.route(pickup, destination);
        distanceKm = route.distanceKm;
        if (route.provider.startsWith('osrm')) durationMin = route.durationMin;
      } catch {
        // Routing failure never fails an estimate; haversine stands.
      }
    }
    const distanceFareMinor = Math.round(distanceKm * rule.perKmMinor);
    const durationFareMinor = durationMin * rule.perMinMinor;
    const rawFare = rule.baseFareMinor + distanceFareMinor + durationFareMinor;
    // DYNAMIC multiplier is 1.0 in Phase 6: demand/supply signals arrive
    // with dispatch analytics in Phase 7+. The cap is still enforced.
    const demandMultiplier = 1.0;
    const fareBeforeFee = Math.max(rule.minimumFareMinor, Math.round(rawFare * demandMultiplier));
    const suggestedFareMinor = fareBeforeFee + rule.bookingFeeMinor;
    return {
      cityId: city.id,
      cityName: city.name,
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      durationMin,
      suggestedFareMinor,
      currency: city.currency,
      pricingMode: rule.mode,
      pricingRuleVersion: rule.version,
      fareBreakdown: {
        baseFareMinor: rule.baseFareMinor,
        distanceFareMinor,
        durationFareMinor,
        minimumFareMinor: rule.minimumFareMinor,
        bookingFeeMinor: rule.bookingFeeMinor,
        demandMultiplier,
      },
    };
  }

  /** Validates a customer offer against the pricing mode. Returns the
   *  offer to store (null for FIXED, where the platform fare applies). */
  validateOffer(mode: string, suggestedFareMinor: number, minimumFareMinor: number, offer: number | null): number | null {
    if (mode === 'FIXED') return null;
    if (offer === null || offer === undefined) return null;
    if (mode === 'NEGOTIATION') {
      if (offer < minimumFareMinor) {
        throw new BadRequestException(`Offer is below the minimum fare of ${minimumFareMinor} minor units`);
      }
      return offer;
    }
    if (mode === 'HYBRID') {
      const low = Math.round(suggestedFareMinor * 0.8);
      const high = Math.round(suggestedFareMinor * 1.2);
      if (offer < low || offer > high) {
        throw new BadRequestException(`In hybrid mode the offer must be within 20% of the suggested fare (${low}–${high} minor units)`);
      }
      return offer;
    }
    // DYNAMIC: platform fare applies, offers are not negotiated in Phase 6.
    return null;
  }
}
