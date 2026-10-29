import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { DEFAULT_SERVICES, DEFAULT_VEHICLE_CATEGORIES } from '../data/store.interface';
import { PACKAGE_CATEGORIES } from '@rahi/shared-types';

/**
 * Phase 13 — Super Admin resources.
 *
 * What "managed" means here, honestly:
 * - Cities are fully managed (create, activate, deactivate).
 * - Pricing rules are versioned: creating a rule for a city+service
 *   that already has one writes the next version, and pricing
 *   always reads the latest version. Old versions are never edited,
 *   so historical rides stay reconstructable.
 * - Service and vehicle codes are fixed by the database enums
 *   (migration 001), so admin management covers display names and
 *   activation — deactivating a service or category removes it from
 *   estimates, it does not delete history.
 * - The service→category mapping and the package-category list are
 *   stored as settings, so they change without a deploy. Defaults
 *   apply until an admin first saves a change.
 * - Every mutation writes an audit row: who, what, before, after.
 */
export const SERVICE_CATEGORIES_SETTING = 'service_categories';
export const PACKAGE_CATEGORIES_SETTING = 'package_categories';

export const DEFAULT_SERVICE_CATEGORIES: Record<string, string[]> = {
  CAR: ['CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM'],
  BIKE: ['BIKE'],
  DELIVERY: ['BIKE', 'CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM'],
};

@Injectable()
export class AdminService {
  constructor(@Inject(STORE) private readonly store: Store) {}

  private async audit(actorId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown) {
    await this.store.addAuditLog({
      actorId, action, targetType, targetId,
      beforeSummary: before === null ? null : JSON.stringify(before),
      afterSummary: after === null ? null : JSON.stringify(after),
      reason: null,
    });
  }

  // ---- Cities ----
  async createCity(adminId: string, input: {
    name: string; countryCode: string; currency: string; timezone: string;
    centreLat: number; centreLng: number;
  }) {
    if (!input.name.trim()) throw new BadRequestException('City name is required');
    if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new BadRequestException('Country code must be two uppercase letters');
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException('Currency must be three uppercase letters');
    if (input.centreLat < -90 || input.centreLat > 90 || input.centreLng < -180 || input.centreLng > 180) {
      throw new BadRequestException('City centre coordinates are out of range');
    }
    const city = await this.store.createCity({ ...input, isActive: true });
    await this.audit(adminId, 'CITY_CREATED', 'CITY', city.id, null, city);
    return city;
  }

  async listCities() {
    return this.store.listCities();
  }

  async setCityActive(adminId: string, cityId: string, isActive: boolean) {
    const before = (await this.store.listCities()).find((c) => c.id === cityId);
    if (!before) throw new NotFoundException('City not found');
    const city = await this.store.setCityActive(cityId, isActive);
    await this.audit(adminId, isActive ? 'CITY_ACTIVATED' : 'CITY_DEACTIVATED', 'CITY', cityId, before, city);
    return city;
  }

  // ---- Pricing rules ----
  async createPricingRule(adminId: string, input: {
    cityId: string | null; serviceCode: string; mode: string;
    baseFareMinor: number; perKmMinor: number; perMinMinor: number;
    minimumFareMinor: number; bookingFeeMinor: number; demandCap: number;
  }) {
    const services = await this.store.listServiceTypes();
    if (!services.some((s) => s.code === input.serviceCode)) {
      throw new BadRequestException(`Unknown service ${input.serviceCode}`);
    }
    if (!['NEGOTIATION', 'FIXED', 'DYNAMIC', 'HYBRID'].includes(input.mode)) {
      throw new BadRequestException(`Unknown pricing mode ${input.mode}`);
    }
    for (const [key, value] of Object.entries({
      baseFareMinor: input.baseFareMinor, perKmMinor: input.perKmMinor,
      perMinMinor: input.perMinMinor, minimumFareMinor: input.minimumFareMinor,
      bookingFeeMinor: input.bookingFeeMinor,
    })) {
      if (!Number.isInteger(value) || value < 0) throw new BadRequestException(`${key} must be a non-negative integer`);
    }
    if (input.demandCap < 1 || input.demandCap > 5) {
      throw new BadRequestException('Demand cap must be between 1 and 5');
    }
    if (input.cityId) {
      const city = (await this.store.listCities()).find((c) => c.id === input.cityId);
      if (!city) throw new NotFoundException('City not found');
    }
    const existing = (await this.store.listPricingRules())
      .filter((r) => r.cityId === input.cityId && r.serviceCode === input.serviceCode);
    const version = Math.max(0, ...existing.map((r) => r.version)) + 1;
    const rule = await this.store.createPricingRule({ ...input, version });
    await this.audit(adminId, 'PRICING_RULE_CREATED', 'PRICING_RULE', rule.id, null, rule);
    return rule;
  }

  async listPricingRules() {
    return this.store.listPricingRules();
  }

  // ---- Catalogues ----
  async listServiceTypes() {
    return this.store.listServiceTypes();
  }

  async updateServiceType(adminId: string, code: string, name: string, isActive: boolean) {
    if (!DEFAULT_SERVICES.some((s) => s.code === code)) {
      throw new BadRequestException(`Service ${code} is not a known service code`);
    }
    if (!name.trim()) throw new BadRequestException('Service name is required');
    const before = (await this.store.listServiceTypes()).find((s) => s.code === code);
    const updated = await this.store.upsertServiceType({ code, name: name.trim(), isActive });
    await this.audit(adminId, 'SERVICE_TYPE_UPDATED', 'SERVICE_TYPE', code, before ?? null, updated);
    return updated;
  }

  async listVehicleCategories() {
    return this.store.listVehicleCategories();
  }

  async updateVehicleCategory(adminId: string, code: string, name: string, isActive: boolean) {
    if (!DEFAULT_VEHICLE_CATEGORIES.some((c) => c.code === code)) {
      throw new BadRequestException(`Vehicle category ${code} is not a known category code`);
    }
    if (!name.trim()) throw new BadRequestException('Category name is required');
    const before = (await this.store.listVehicleCategories()).find((c) => c.code === code);
    const updated = await this.store.upsertVehicleCategory({ code, name: name.trim(), isActive });
    await this.audit(adminId, 'VEHICLE_CATEGORY_UPDATED', 'VEHICLE_CATEGORY', code, before ?? null, updated);
    return updated;
  }

  async getServiceCategories(): Promise<Record<string, string[]>> {
    const raw = await this.store.getSetting(SERVICE_CATEGORIES_SETTING);
    if (!raw) return DEFAULT_SERVICE_CATEGORIES;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
    } catch {
      // Corrupt setting falls back to defaults rather than breaking estimates.
    }
    return DEFAULT_SERVICE_CATEGORIES;
  }

  async setServiceCategories(adminId: string, mapping: Record<string, string[]>) {
    const services = await this.store.listServiceTypes();
    const categories = await this.store.listVehicleCategories();
    for (const [service, cats] of Object.entries(mapping)) {
      if (!services.some((s) => s.code === service)) throw new BadRequestException(`Unknown service ${service}`);
      if (!Array.isArray(cats) || cats.length === 0) throw new BadRequestException(`Service ${service} needs at least one category`);
      for (const cat of cats) {
        if (!categories.some((c) => c.code === cat)) throw new BadRequestException(`Unknown vehicle category ${cat}`);
      }
    }
    const before = await this.getServiceCategories();
    await this.store.setSetting(SERVICE_CATEGORIES_SETTING, JSON.stringify(mapping), adminId);
    await this.audit(adminId, 'SERVICE_CATEGORIES_UPDATED', 'SETTING', SERVICE_CATEGORIES_SETTING, before, mapping);
    return mapping;
  }

  async getPackageCategories(): Promise<string[]> {
    const raw = await this.store.getSetting(PACKAGE_CATEGORIES_SETTING);
    if (!raw) return [...PACKAGE_CATEGORIES];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((c) => typeof c === 'string')) return parsed;
    } catch {
      // Fall through to defaults.
    }
    return [...PACKAGE_CATEGORIES];
  }

  async setPackageCategories(adminId: string, categories: string[]) {
    const cleaned = [...new Set(categories.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (cleaned.length === 0) throw new BadRequestException('At least one package category is required');
    if (cleaned.some((c) => !/^[A-Z0-9_]+$/.test(c))) {
      throw new BadRequestException('Package categories must be uppercase letters, digits or underscores');
    }
    const before = await this.getPackageCategories();
    await this.store.setSetting(PACKAGE_CATEGORIES_SETTING, JSON.stringify(cleaned), adminId);
    await this.audit(adminId, 'PACKAGE_CATEGORIES_UPDATED', 'SETTING', PACKAGE_CATEGORIES_SETTING, before, cleaned);
    return cleaned;
  }

  // ---- Audit + overview ----
  async listAuditLogs(limit = 100) {
    return this.store.listAuditLogs(Math.min(Math.max(limit, 1), 500));
  }

  async getOverview() {
    return this.store.getAdminOverview();
  }
}
