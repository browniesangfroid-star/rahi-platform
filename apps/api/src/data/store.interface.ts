export interface UserRecord {
  id: string;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  status: string;
  phoneVerifiedAt: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  firstName: string;
  lastName: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  permissionNames: string[];
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface OtpRecord {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** Data-access abstraction. Postgres is the production implementation;
 *  InMemoryStore is for tests and for booting without a database in dev.
 *  Services must never talk to `pg` or to Maps directly. */
export interface Store extends DriverStore, RideStore, DispatchStore, OfferStore, TrackingStore, TripStore, DeliveryStore, PaymentsStore, AdminStore, SupportStore, AnalyticsStore {
  /** Liveness probe for the backing database. Never throws. */
  ping(): Promise<boolean>;
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByPhone(phone: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createPhoneUser(phone: string): Promise<UserRecord>;
  createAdminUser(email: string, passwordHash: string, firstName: string, lastName: string): Promise<UserRecord>;
  updateUserProfile(id: string, firstName: string, lastName: string): Promise<UserRecord | null>;
  setMfa(id: string, secret: string | null, enabled: boolean): Promise<UserRecord | null>;
  markPhoneVerified(id: string): Promise<void>;
  createOtp(phone: string, codeHash: string, expiresAt: Date): Promise<OtpRecord>;
  getLatestOtp(phone: string): Promise<OtpRecord | null>;
  incrementOtpAttempts(id: string): Promise<void>;
  consumeOtp(id: string): Promise<void>;
  createSession(userId: string, refreshTokenHash: string, expiresAt: Date): Promise<SessionRecord>;
  getSessionByHash(hash: string): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  listRoles(): Promise<RoleRecord[]>;
  createRole(name: string): Promise<RoleRecord>;
  addPermissionToRole(roleId: string, permissionName: string): Promise<RoleRecord | null>;
  assignRoleToUser(userId: string, roleId: string): Promise<void>;
  getRolesForUser(userId: string): Promise<RoleRecord[]>;
  getPermissionsForUser(userId: string): Promise<string[]>;
}

export interface DriverProfileRecord {
  userId: string;
  kycStatus: string;
  rejectionReason: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bankAccount: string | null;
}

export interface DriverDocumentRecord {
  id: string;
  driverUserId: string;
  documentType: string;
  storageKey: string;
  mimeType: string;
  expiresAt: string | null;
}

export interface VehicleRecord {
  id: string;
  ownerUserId: string;
  categoryCode: string;
  make: string;
  model: string;
  year: number;
  color: string;
  registrationNumber: string;
  approvalStatus: string;
  isActive: boolean;
}

export interface DriverHistoryRecord {
  driverUserId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface DriverStore {
  getDriverProfile(userId: string): Promise<DriverProfileRecord | null>;
  createDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null): Promise<DriverProfileRecord>;
  updateDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null): Promise<DriverProfileRecord | null>;
  setDriverKycStatus(userId: string, status: string, reason: string | null): Promise<DriverProfileRecord | null>;
  listDriverProfilesByKyc(status: string): Promise<DriverProfileRecord[]>;
  addDriverDocument(doc: Omit<DriverDocumentRecord, 'id'>): Promise<DriverDocumentRecord>;
  getDriverDocument(id: string): Promise<DriverDocumentRecord | null>;
  listDriverDocuments(userId: string): Promise<DriverDocumentRecord[]>;
  addDriverHistory(entry: Omit<DriverHistoryRecord, 'createdAt'>): Promise<void>;
  listDriverHistory(userId: string): Promise<DriverHistoryRecord[]>;
  createVehicle(v: Omit<VehicleRecord, 'id' | 'approvalStatus' | 'isActive'>): Promise<VehicleRecord>;
  listVehiclesByOwner(userId: string): Promise<VehicleRecord[]>;
  getVehicle(id: string): Promise<VehicleRecord | null>;
  setVehicleApproval(id: string, status: string): Promise<VehicleRecord | null>;
  setActiveVehicle(userId: string, vehicleId: string): Promise<VehicleRecord | null>;
  addAuditLog(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<AuditLogRecord>;
}

export interface CityRecord {
  id: string;
  name: string;
  countryCode: string;
  currency: string;
  timezone: string;
  centreLat: number | null;
  centreLng: number | null;
  isActive: boolean;
}

/**
 * Phase 13 catalogues. Service and vehicle codes are fixed by the
 * database enums (migration 001), so admin management means names
 * and activation — not inventing new codes. The defaults below are
 * reference data, used whenever no admin override is stored.
 */
export interface CatalogRecord {
  code: string;
  name: string;
  isActive: boolean;
}

export const DEFAULT_SERVICES: CatalogRecord[] = [
  { code: 'CAR', name: 'Car', isActive: true },
  { code: 'BIKE', name: 'Bike', isActive: true },
  { code: 'DELIVERY', name: 'Delivery', isActive: true },
];

export const DEFAULT_VEHICLE_CATEGORIES: CatalogRecord[] = [
  { code: 'BIKE', name: 'Bike', isActive: true },
  { code: 'CAR_ECONOMY', name: 'Economy car', isActive: true },
  { code: 'CAR_STANDARD', name: 'Standard car', isActive: true },
  { code: 'CAR_PREMIUM', name: 'Premium car', isActive: true },
];

export function mergeCatalog(defaults: CatalogRecord[], overrides: CatalogRecord[]): CatalogRecord[] {
  const byCode = new Map(defaults.map((d) => [d.code, { ...d }]));
  for (const override of overrides) {
    if (byCode.has(override.code)) byCode.set(override.code, { ...override });
  }
  return [...byCode.values()];
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeSummary: string | null;
  afterSummary: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface AdminOverview {
  usersTotal: number;
  driversByKyc: Record<string, number>;
  ridesByStatus: Record<string, number>;
  paymentsByStatus: Record<string, number>;
  commissionBalanceMinor: number;
  pendingTopups: number;
  pendingWithdrawals: number;
  citiesTotal: number;
  activeCities: number;
}

export interface RatingRecord {
  id: string;
  rideId: string;
  raterUserId: string;
  raterRole: string;
  ratedUserId: string;
  stars: number;
  comment: string | null;
  reportReason: string | null;
  createdAt: Date;
}

export interface SupportTicketRecord {
  id: string;
  rideId: string | null;
  reporterUserId: string;
  category: string;
  subject: string;
  status: string;
  createdAt: Date;
}

export interface TicketMessageRecord {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorRole: string;
  message: string;
  createdAt: Date;
}

export interface SafetyIncidentRecord {
  id: string;
  rideId: string;
  reporterUserId: string;
  priority: string;
  status: string;
  snapshot: string;
  note: string | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export interface ShareLinkRecord {
  id: string;
  rideId: string;
  createdBy: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CancelledRideEntry {
  rideId: string;
  customerId: string;
  driverId: string | null;
  status: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  cancelledAt: Date;
}

export interface SupportStore {
  createRating(rating: Omit<RatingRecord, 'id' | 'createdAt'>): Promise<RatingRecord>;
  getRatingByRideAndRole(rideId: string, raterRole: string): Promise<RatingRecord | null>;
  createTicket(ticket: Omit<SupportTicketRecord, 'id' | 'createdAt'>): Promise<SupportTicketRecord>;
  getTicket(id: string): Promise<SupportTicketRecord | null>;
  listTickets(reporterUserId: string | null, status: string | null): Promise<SupportTicketRecord[]>;
  setTicketStatus(id: string, status: string): Promise<SupportTicketRecord | null>;
  addTicketMessage(message: Omit<TicketMessageRecord, 'id' | 'createdAt'>): Promise<TicketMessageRecord>;
  listTicketMessages(ticketId: string): Promise<TicketMessageRecord[]>;
  createIncident(incident: Omit<SafetyIncidentRecord, 'id' | 'createdAt'>): Promise<SafetyIncidentRecord>;
  getOpenIncidentByRide(rideId: string): Promise<SafetyIncidentRecord | null>;
  getIncident(id: string): Promise<SafetyIncidentRecord | null>;
  listIncidents(status: string | null): Promise<SafetyIncidentRecord[]>;
  resolveIncident(id: string, resolutionNote: string): Promise<SafetyIncidentRecord | null>;
  createShareLink(link: Omit<ShareLinkRecord, 'id' | 'createdAt'>): Promise<ShareLinkRecord>;
  getShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null>;
  listShareLinksByRide(rideId: string): Promise<ShareLinkRecord[]>;
  revokeShareLink(id: string): Promise<ShareLinkRecord | null>;
  listCancelledRides(since: Date): Promise<CancelledRideEntry[]>;
  countCancelsByActorSince(actorId: string, since: Date): Promise<number>;
  setUserStatus(id: string, status: string, reason: string | null): Promise<UserRecord | null>;
}

export interface RideStats {
  requested: number;
  completed: number;
  cancelled: number;
  noDriverFound: number;
  avgFareMinor: number | null;
  totalCommissionMinor: number;
}

export interface DispatchStats {
  attempts: number;
  byOutcome: Record<string, number>;
  avgScore: number | null;
  byRadius: Record<string, number>;
  avgMatchSeconds: number | null;
  offersSent: number;
  offersAccepted: number;
}

export interface CityStatRow {
  cityId: string;
  cityName: string;
  requested: number;
  completed: number;
  cancelled: number;
  commissionMinor: number;
  avgFareMinor: number | null;
}

export interface DriverLeaderRow {
  driverUserId: string;
  completedRides: number;
  earningsMinor: number;
  avgRating: number | null;
  acceptanceRate: number | null;
}

export interface DailyRow {
  date: string;
  requested: number;
  completed: number;
  commissionMinor: number;
}

export interface CityFairness {
  cityId: string;
  cityMaxTripsToday: number;
  drivers: { driverUserId: string; tripsToday: number }[];
}

export interface AnalyticsStore {
  getRideStats(since: Date): Promise<RideStats>;
  getDispatchStats(since: Date): Promise<DispatchStats>;
  getCityStats(since: Date): Promise<CityStatRow[]>;
  getDriverLeaderboard(since: Date, limit: number): Promise<DriverLeaderRow[]>;
  getDailySeries(since: Date): Promise<DailyRow[]>;
  getDriverTripsInCityToday(driverUserId: string, cityId: string, dayStart: Date): Promise<number>;
  getCityFairness(cityId: string, dayStart: Date): Promise<CityFairness>;
}

export interface AdminStore {
  setCityActive(id: string, isActive: boolean): Promise<CityRecord | null>;
  listPricingRules(): Promise<PricingRuleRecord[]>;
  listServiceTypes(): Promise<CatalogRecord[]>;
  upsertServiceType(record: CatalogRecord): Promise<CatalogRecord>;
  listVehicleCategories(): Promise<CatalogRecord[]>;
  upsertVehicleCategory(record: CatalogRecord): Promise<CatalogRecord>;
  listAuditLogs(limit: number): Promise<AuditLogRecord[]>;
  getAdminOverview(): Promise<AdminOverview>;
}

export interface PricingRuleRecord {
  id: string;
  cityId: string | null;
  serviceCode: string;
  mode: string;
  baseFareMinor: number;
  perKmMinor: number;
  perMinMinor: number;
  minimumFareMinor: number;
  bookingFeeMinor: number;
  demandCap: number;
  version: number;
}

export interface RideRequestRecord {
  id: string;
  customerId: string;
  cityId: string | null;
  serviceCode: string;
  categoryCode: string | null;
  minimumFareMinor: number | null;
  bookingFeeMinor: number | null;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  pickupLabel: string | null;
  destinationLabel: string | null;
  suggestedFareMinor: number;
  customerOfferMinor: number | null;
  pricingMode: string;
  pricingRuleVersion: number | null;
  status: string;
  paymentMethod: string | null;
  distanceKm: number;
  durationMin: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface RequestHistoryRecord {
  requestId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface RideStore {
  createCity(city: Omit<CityRecord, 'id'>): Promise<CityRecord>;
  listCities(): Promise<CityRecord[]>;
  createPricingRule(rule: Omit<PricingRuleRecord, 'id'>): Promise<PricingRuleRecord>;
  getPricingRule(cityId: string | null, serviceCode: string): Promise<PricingRuleRecord | null>;
  createRideRequest(r: Omit<RideRequestRecord, 'id' | 'createdAt'>): Promise<RideRequestRecord>;
  getRideRequest(id: string): Promise<RideRequestRecord | null>;
  listRideRequestsByCustomer(customerId: string): Promise<RideRequestRecord[]>;
  setRideRequestStatus(id: string, status: string): Promise<RideRequestRecord | null>;
  addRequestHistory(entry: Omit<RequestHistoryRecord, 'createdAt'>): Promise<void>;
  listRequestHistory(requestId: string): Promise<RequestHistoryRecord[]>;
}

export interface DriverStatsRecord {
  driverUserId: string;
  tripsToday: number;
  offersSent: number;
  offersAccepted: number;
  ratingSum: number;
  ratingCount: number;
}

export interface DispatchAttemptRecord {
  requestId: string;
  driverUserId: string;
  radiusKm: number;
  score: number;
  distanceKm: number;
  outcome: string;
  createdAt: Date;
}

export interface OfferRecord {
  id: string;
  requestId: string;
  driverId: string;
  proposedFareMinor: number;
  status: string;
  expiresAt: Date;
  counterCount: number;
  createdAt: Date;
}

export interface RideRecord {
  id: string;
  requestId: string;
  customerId: string;
  driverId: string | null;
  vehicleId: string | null;
  status: string;
  finalFareMinor: number | null;
  commissionMinor: number | null;
  commissionRuleVersion: number | null;
  paymentMethod: string | null;
  createdAt: Date;
}

export interface RideLocationRecord {
  rideId: string;
  lat: number;
  lng: number;
  recordedAt: Date;
}

export interface RidePinRecord {
  rideId: string;
  pinHash: string;
  attempts: number;
  verifiedAt: Date | null;
}

export interface RideHistoryRecord {
  rideId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface DeliveryRequestDetails {
  requestId: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  packageCategory: string;
  sizeWeight: string | null;
  notes: string | null;
}

export interface DeliveryDetails extends DeliveryRequestDetails {
  rideId: string;
  status: string;
  photoStorageKey: string | null;
}

export interface DeliveryProofRecord {
  id: string;
  rideId: string;
  proofType: string;
  storageKey: string | null;
  otpHash: string | null;
  verifiedBy: string | null;
  attempts: number;
  createdAt: Date;
}

export interface DeliveryHistoryRecord {
  rideId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface WalletAccountRecord {
  id: string;
  ownerType: string;
  ownerId: string | null;
  currency: string;
}

export interface LedgerEntryRecord {
  id: string;
  accountId: string;
  entryType: string;
  amountMinor: number;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string | null;
  reason: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface PaymentRecord {
  id: string;
  rideId: string | null;
  provider: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface CommissionRuleRecord {
  id: string;
  scope: string;
  cityId: string | null;
  serviceCode: string | null;
  driverUserId: string | null;
  ratePercent: number;
  version: number;
}

export interface TopupRecord {
  id: string;
  userId: string;
  ownerType: string;
  amountMinor: number;
  currency: string;
  status: string;
  reference: string | null;
  reviewedBy: string | null;
  createdAt: Date;
}

export interface WithdrawalRecord {
  id: string;
  userId: string;
  amountMinor: number;
  currency: string;
  status: string;
  payoutReference: string | null;
  reviewedBy: string | null;
  createdAt: Date;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  rideId: string;
  amountMinor: number;
  commissionReversedMinor: number;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface PaymentsStore {
  getOrCreateAccount(ownerType: string, ownerId: string | null, currency: string): Promise<WalletAccountRecord>;
  getBalance(ownerType: string, ownerId: string | null): Promise<number>;
  createLedgerEntry(entry: Omit<LedgerEntryRecord, 'id' | 'createdAt'>): Promise<LedgerEntryRecord>;
  listLedgerEntries(ownerType: string, ownerId: string | null, limit: number): Promise<LedgerEntryRecord[]>;
  createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord>;
  getPaymentByRideId(rideId: string): Promise<PaymentRecord | null>;
  getPaymentById(id: string): Promise<PaymentRecord | null>;
  setPaymentStatus(id: string, status: string): Promise<PaymentRecord | null>;
  setRideCommission(rideId: string, commissionMinor: number, ruleVersion: number): Promise<void>;
  createCommissionRule(rule: Omit<CommissionRuleRecord, 'id'>): Promise<CommissionRuleRecord>;
  listCommissionRules(): Promise<CommissionRuleRecord[]>;
  resolveCommissionRule(driverUserId: string, cityId: string | null, serviceCode: string): Promise<CommissionRuleRecord | null>;
  createTopup(topup: Omit<TopupRecord, 'id' | 'createdAt'>): Promise<TopupRecord>;
  getTopup(id: string): Promise<TopupRecord | null>;
  listTopups(userId: string): Promise<TopupRecord[]>;
  setTopupStatus(id: string, status: string, reviewedBy: string): Promise<TopupRecord | null>;
  createWithdrawal(w: Omit<WithdrawalRecord, 'id' | 'createdAt'>): Promise<WithdrawalRecord>;
  getWithdrawal(id: string): Promise<WithdrawalRecord | null>;
  listWithdrawals(userId: string): Promise<WithdrawalRecord[]>;
  setWithdrawalStatus(id: string, status: string, reviewedBy: string, payoutReference: string | null): Promise<WithdrawalRecord | null>;
  createRefund(refund: Omit<RefundRecord, 'id' | 'createdAt'>): Promise<RefundRecord>;
  listRefundsByPayment(paymentId: string): Promise<RefundRecord[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, changedBy: string | null): Promise<void>;
}

export interface DeliveryStore {
  createDeliveryRequestDetails(details: DeliveryRequestDetails): Promise<void>;
  getDeliveryRequestDetails(requestId: string): Promise<DeliveryRequestDetails | null>;
  createDeliveryDetails(details: DeliveryDetails): Promise<void>;
  getDeliveryDetails(rideId: string): Promise<DeliveryDetails | null>;
  setDeliveryStatus(rideId: string, status: string): Promise<DeliveryDetails | null>;
  addDeliveryHistory(entry: Omit<DeliveryHistoryRecord, 'createdAt'>): Promise<void>;
  listDeliveryHistory(rideId: string): Promise<DeliveryHistoryRecord[]>;
  createDeliveryProof(proof: Omit<DeliveryProofRecord, 'id' | 'createdAt'>): Promise<DeliveryProofRecord>;
  listDeliveryProofs(rideId: string): Promise<DeliveryProofRecord[]>;
  getDeliveryProofById(id: string): Promise<DeliveryProofRecord | null>;
  getDeliveryOtpProof(rideId: string): Promise<DeliveryProofRecord | null>;
  incrementDeliveryProofAttempts(id: string): Promise<DeliveryProofRecord | null>;
  setDeliveryProofVerified(id: string, verifiedBy: string): Promise<void>;
}

export interface TripStore {
  setRideStatus(rideId: string, status: string): Promise<RideRecord | null>;
  addRideHistory(entry: Omit<RideHistoryRecord, 'createdAt'>): Promise<void>;
  listRideHistory(rideId: string): Promise<RideHistoryRecord[]>;
  createRidePin(pin: RidePinRecord): Promise<void>;
  getRidePin(rideId: string): Promise<RidePinRecord | null>;
  incrementPinAttempts(rideId: string): Promise<RidePinRecord | null>;
  setPinVerified(rideId: string): Promise<void>;
}

export interface TrackingStore {
  addRideLocation(location: Omit<RideLocationRecord, 'recordedAt'>): Promise<RideLocationRecord>;
  getLatestRideLocation(rideId: string): Promise<RideLocationRecord | null>;
  listRideLocations(rideId: string, limit: number): Promise<RideLocationRecord[]>;
}

export interface AcceptOfferTxInput {
  requestId: string;
  offerId: string;
  customerId: string;
  driverId: string;
  vehicleId: string;
  finalFareMinor: number;
  paymentMethod: string | null;
  pinHash: string;
  deliveryDetails: DeliveryRequestDetails | null;
  deliveryOtpHash: string | null;
}

export interface AcceptOfferTxResult {
  ride: RideRecord;
  offer: OfferRecord;
  request: RideRequestRecord;
}

export interface OfferStore {
  createOffer(offer: Omit<OfferRecord, 'id' | 'createdAt'>): Promise<OfferRecord>;
  getOffer(id: string): Promise<OfferRecord | null>;
  listOffersByRequest(requestId: string): Promise<OfferRecord[]>;
  setOfferStatus(id: string, status: string): Promise<OfferRecord | null>;
  updateOfferFare(id: string, fareMinor: number, counterCount: number): Promise<OfferRecord | null>;
  createRide(ride: Omit<RideRecord, 'id' | 'createdAt'>): Promise<RideRecord>;
  getRideByRequestId(requestId: string): Promise<RideRecord | null>;
  getRideById(id: string): Promise<RideRecord | null>;
  setDispatchAttemptOutcome(requestId: string, driverId: string, outcome: string): Promise<void>;
  incrementOffersAccepted(driverId: string): Promise<void>;
  listOpenRequestsForDriver(driverId: string): Promise<RideRequestRecord[]>;  /**
   * Phase 16: single-transaction accept. Implementations that run
   * against a real database MUST perform every write of the accept
   * (ride, request status + history, offer outcomes, dispatch
   * outcomes, driver stats, PIN, delivery rows) inside one
   * transaction with the request row locked (SELECT ... FOR
   * UPDATE), re-checking OFFERING + LIVE inside the lock. Throws
   * Error('REQUEST_NOT_FOUND' | 'REQUEST_NOT_OFFERING' |
   * 'OFFER_NOT_LIVE') on conflicts. Optional: stores without it
   * (InMemory) keep the service-level per-request lock path.
   */
  acceptOfferAtomic?(input: AcceptOfferTxInput): Promise<AcceptOfferTxResult>;
}

export interface DispatchStore {
  getDriverStats(driverUserId: string): Promise<DriverStatsRecord>;
  setDriverStats(stats: DriverStatsRecord): Promise<void>;
  incrementOfferSent(driverUserId: string): Promise<void>;
  addDispatchAttempt(attempt: DispatchAttemptRecord): Promise<void>;
  listDispatchAttempts(requestId: string): Promise<DispatchAttemptRecord[]>;
  getDeclinedDriverIds(requestId: string): Promise<string[]>;
}

export const STORE = 'STORE';
