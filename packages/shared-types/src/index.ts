// Rahi shared types — single source of truth for states, roles and events.
// The API, mobile apps and admin web import these; they must never redefine
// ride/delivery states as ad-hoc strings elsewhere.

export type Role =
  | 'CUSTOMER' | 'DRIVER' | 'COURIER' | 'DISPATCHER' | 'SUPPORT_AGENT'
  | 'FINANCE_ADMIN' | 'OPERATIONS_ADMIN' | 'CITY_ADMIN' | 'SUPER_ADMIN';

export type Permission =
  | 'users.read' | 'users.suspend' | 'drivers.approve' | 'drivers.reject'
  | 'rides.read' | 'rides.cancel' | 'rides.assign' | 'pricing.manage'
  | 'commission.manage' | 'payments.manage' | 'refunds.manage'
  | 'cities.manage' | 'admins.manage' | 'roles.manage' | 'reports.read'
  | 'audit.read';

export type ServiceType = 'CAR' | 'BIKE' | 'DELIVERY';
// Future services are added here + in vehicle_categories / service_types tables:
// 'RICKSHAW' | 'INTERCITY' | 'FREIGHT' | 'RENTAL' | 'GROCERY'

export type VehicleCategory =
  | 'BIKE' | 'CAR_ECONOMY' | 'CAR_STANDARD' | 'CAR_PREMIUM';

export type PricingMode = 'NEGOTIATION' | 'FIXED' | 'DYNAMIC' | 'HYBRID';

export type KycStatus =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED'
  | 'REJECTED' | 'SUSPENDED' | 'EXPIRED';

export type RideStatus =
  | 'DRAFT' | 'SEARCHING' | 'OFFERING' | 'DRIVER_SELECTED'
  | 'DRIVER_EN_ROUTE' | 'DRIVER_ARRIVED' | 'WAITING_FOR_PIN'
  | 'IN_PROGRESS' | 'COMPLETED'
  | 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_DRIVER'
  | 'CANCELLED_BY_ADMIN' | 'NO_DRIVER_FOUND' | 'EXPIRED';

export type DeliveryStatus =
  | 'REQUESTED' | 'COURIER_SELECTED' | 'COURIER_EN_ROUTE_PICKUP'
  | 'PICKED_UP' | 'IN_TRANSIT' | 'ARRIVED' | 'DELIVERED'
  | 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_COURIER' | 'CANCELLED_BY_ADMIN';

export type PaymentStatus =
  | 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED'
  | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export type PaymentMethod = 'CASH' | 'WALLET'; // CARD, JAZZCASH, EASYPAISA later

export type LedgerEntryType =
  | 'RIDE_PAYMENT' | 'COMMISSION' | 'TOP_UP' | 'WITHDRAWAL'
  | 'BONUS' | 'REFUND' | 'ADMIN_ADJUSTMENT';

export type SocketEvent =
  | 'ride.request.created' | 'ride.offer.created' | 'ride.offer.updated'
  | 'ride.offer.expired' | 'ride.driver.selected' | 'driver.location.updated'
  | 'driver.arrived' | 'ride.pin.required' | 'ride.started'
  | 'ride.completed' | 'ride.cancelled' | 'delivery.updated'
  | 'safety.incident.created' | 'notification.created';

export interface GeoPoint { lat: number; lng: number; }
export interface Money { amountMinor: number; currency: string; } // integer minor units only

export * from './ride-state-machine';
export * from './delivery-state-machine';
export * from './driver-kyc-state-machine';
