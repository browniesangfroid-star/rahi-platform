// Pure, dependency-free state machines. Imported by the API; unit-tested in Phase 16.
// Illegal transitions throw — the API maps that to HTTP 409, never to a silent state change.
import type { RideStatus } from './index';

export const RIDE_TERMINAL: ReadonlySet<RideStatus> = new Set([
  'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN', 'NO_DRIVER_FOUND', 'EXPIRED',
]);

const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  DRAFT: ['SEARCHING'],
  SEARCHING: ['OFFERING', 'NO_DRIVER_FOUND', 'CANCELLED_BY_CUSTOMER', 'EXPIRED'],
  OFFERING: ['DRIVER_SELECTED', 'NO_DRIVER_FOUND', 'CANCELLED_BY_CUSTOMER', 'EXPIRED'],
  DRIVER_SELECTED: ['DRIVER_EN_ROUTE', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  DRIVER_EN_ROUTE: ['DRIVER_ARRIVED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  DRIVER_ARRIVED: ['WAITING_FOR_PIN', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  WAITING_FOR_PIN: ['IN_PROGRESS', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED_BY_ADMIN'],
  COMPLETED: [],
  CANCELLED_BY_CUSTOMER: [], CANCELLED_BY_DRIVER: [], CANCELLED_BY_ADMIN: [],
  NO_DRIVER_FOUND: [], EXPIRED: [],
};

export function canTransitionRide(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from].includes(to);
}

export function transitionRide(from: RideStatus, to: RideStatus): RideStatus {
  if (!canTransitionRide(from, to)) {
    throw new Error(`Illegal ride transition: ${from} -> ${to}`);
  }
  return to;
}
