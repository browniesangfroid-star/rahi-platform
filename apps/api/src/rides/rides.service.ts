import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { PricingService, type Point } from './pricing.service';
import { canTransitionRide, type RideStatus } from '@rahi/shared-types';
import { PACKAGE_CATEGORIES } from '@rahi/shared-types';

export interface DeliveryDetailsInput {
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  packageCategory: string;
  sizeWeight: string | null;
  notes: string | null;
}

export interface CreateRequestInput {
  customerId: string;
  pickup: Point;
  destination: Point;
  pickupLabel: string | null;
  destinationLabel: string | null;
  serviceCode: string;
  categoryCode: string | null;
  customerOfferMinor: number | null;
  paymentMethod: string;
  deliveryDetails: DeliveryDetailsInput | null;
}

/**
 * Ride requesting (Phase 6). Dispatch (Phase 7) and offers (Phase 8)
 * consume these requests; this service only creates, reads and cancels
 * them, and every status change goes through the shared state machine.
 */
@Injectable()
export class RidesService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    private readonly pricing: PricingService,
  ) {}

  async estimate(pickup: Point, destination: Point, serviceCode: string, categoryCode: string | null) {
    return this.pricing.estimate(pickup, destination, serviceCode, categoryCode);
  }

  async getPackageCategories(): Promise<string[]> {
    const raw = await this.store.getSetting('package_categories');
    if (!raw) return [...PACKAGE_CATEGORIES];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((c) => typeof c === 'string')) return parsed;
    } catch {
      // Fall through to defaults.
    }
    return [...PACKAGE_CATEGORIES];
  }

  async requestRide(input: CreateRequestInput) {
    // Delivery details are required for DELIVERY (couriers must see the
    // package before offering) and rejected for other services.
    if (input.serviceCode === 'DELIVERY') {
      if (!input.deliveryDetails) {
        throw new BadRequestException('Delivery details (sender, recipient, package category) are required for delivery requests');
      }
      // Phase 13: package categories are admin-managed (setting
      // 'package_categories', owned by AdminService); the compiled
      // list is only the default.
      const categories = await this.getPackageCategories();
      if (!categories.includes(input.deliveryDetails.packageCategory)) {
        throw new BadRequestException(`Unknown package category ${input.deliveryDetails.packageCategory}`);
      }
    } else if (input.deliveryDetails) {
      throw new BadRequestException('Delivery details are only valid for delivery requests');
    }
    const estimate = await this.pricing.estimate(input.pickup, input.destination, input.serviceCode, input.categoryCode);
    const rule = await this.pricing.getRule(estimate.cityId, input.serviceCode);
    const offer = this.pricing.validateOffer(rule.mode, estimate.suggestedFareMinor, rule.minimumFareMinor, input.customerOfferMinor);
    const request = await this.store.createRideRequest({
      customerId: input.customerId,
      cityId: estimate.cityId,
      serviceCode: input.serviceCode,
      categoryCode: input.categoryCode,
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      destinationLat: input.destination.lat,
      destinationLng: input.destination.lng,
      pickupLabel: input.pickupLabel,
      destinationLabel: input.destinationLabel,
      suggestedFareMinor: estimate.suggestedFareMinor,
      customerOfferMinor: offer,
      minimumFareMinor: rule.minimumFareMinor,
      bookingFeeMinor: rule.bookingFeeMinor,
      pricingMode: rule.mode,
      pricingRuleVersion: rule.version,
      status: 'SEARCHING',
      paymentMethod: input.paymentMethod,
      distanceKm: estimate.distanceKm,
      durationMin: estimate.durationMin,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    await this.store.addRequestHistory({
      requestId: request.id, fromStatus: null, toStatus: 'SEARCHING',
      actorId: input.customerId, actorRole: 'CUSTOMER', reason: null,
    });
    if (input.deliveryDetails) {
      await this.store.createDeliveryRequestDetails({ ...input.deliveryDetails, requestId: request.id });
    }
    return request;
  }

  async getRequest(id: string, customerId: string, isAdmin: boolean) {
    const request = await this.store.getRideRequest(id);
    if (!request) throw new NotFoundException('Ride request not found');
    if (request.customerId !== customerId && !isAdmin) {
      throw new ForbiddenException('Not authorised to view this ride');
    }
    return request;
  }

  async listMyRequests(customerId: string) {
    return this.store.listRideRequestsByCustomer(customerId);
  }

  async cancelRequest(id: string, customerId: string, reason: string | null) {
    const request = await this.store.getRideRequest(id);
    if (!request) throw new NotFoundException('Ride request not found');
    if (request.customerId !== customerId) {
      throw new ForbiddenException('Not authorised to cancel this ride');
    }
    const from = request.status as RideStatus;
    if (!canTransitionRide(from, 'CANCELLED_BY_CUSTOMER')) {
      throw new ConflictException(`Cannot cancel a ride in status ${from}`);
    }
    await this.store.setRideRequestStatus(id, 'CANCELLED_BY_CUSTOMER');
    await this.store.addRequestHistory({
      requestId: id, fromStatus: from, toStatus: 'CANCELLED_BY_CUSTOMER',
      actorId: customerId, actorRole: 'CUSTOMER', reason,
    });
    return this.store.getRideRequest(id);
  }

  async timeline(id: string, customerId: string, isAdmin: boolean) {
    await this.getRequest(id, customerId, isAdmin);
    return this.store.listRequestHistory(id);
  }
}
