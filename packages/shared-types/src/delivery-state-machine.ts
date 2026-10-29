import type { DeliveryStatus } from './index';

const TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  REQUESTED: ['COURIER_SELECTED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  COURIER_SELECTED: ['COURIER_EN_ROUTE_PICKUP', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  COURIER_EN_ROUTE_PICKUP: ['PICKED_UP', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  PICKED_UP: ['IN_TRANSIT', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  IN_TRANSIT: ['ARRIVED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  ARRIVED: ['DELIVERED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_COURIER', 'CANCELLED_BY_ADMIN'],
  DELIVERED: [],
  CANCELLED_BY_CUSTOMER: [], CANCELLED_BY_COURIER: [], CANCELLED_BY_ADMIN: [],
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionDelivery(from: DeliveryStatus, to: DeliveryStatus): DeliveryStatus {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`Illegal delivery transition: ${from} -> ${to}`);
  }
  return to;
}

export const PACKAGE_CATEGORIES = ['DOCUMENT', 'FOOD', 'PARCEL', 'GROCERY', 'FRAGILE', 'OTHER'] as const;
