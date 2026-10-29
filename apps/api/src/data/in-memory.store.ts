import { randomUUID } from 'crypto';
import { mergeCatalog, DEFAULT_SERVICES, DEFAULT_VEHICLE_CATEGORIES } from './store.interface.js';
import type { AdminOverview, AuditLogRecord, CancelledRideEntry, CatalogRecord, CityFairness, CityStatRow, DailyRow, DispatchStats, DriverLeaderRow, CityRecord, CommissionRuleRecord, DeliveryDetails, DeliveryHistoryRecord, DeliveryProofRecord, DeliveryRequestDetails, DispatchAttemptRecord, DriverDocumentRecord, DriverHistoryRecord, DriverProfileRecord, DriverStatsRecord, LedgerEntryRecord, OfferRecord, OtpRecord, PaymentRecord, PricingRuleRecord, RefundRecord, RequestHistoryRecord, RideHistoryRecord, RideLocationRecord, RidePinRecord, RideRecord, RideStats, RatingRecord, SafetyIncidentRecord, ShareLinkRecord, SupportTicketRecord, TicketMessageRecord, RideRequestRecord, RoleRecord, SessionRecord, Store, TopupRecord, UserRecord, VehicleRecord, WalletAccountRecord, WithdrawalRecord } from './store.interface';

function baseUser(partial: Partial<UserRecord> & { id: string }): UserRecord {
  return {
    phone: null, email: null, passwordHash: null, status: 'ACTIVE',
    phoneVerifiedAt: null, mfaEnabled: false, mfaSecret: null,
    firstName: '', lastName: '', ...partial,
  };
}

export class InMemoryStore implements Store {
  users = new Map<string, UserRecord>();
  otps: OtpRecord[] = [];
  sessions = new Map<string, SessionRecord>();
  roles = new Map<string, RoleRecord>();
  userRoles = new Map<string, Set<string>>();

  async getUserById(id: string) { return this.users.get(id) ?? null; }
  async getUserByPhone(phone: string) {
    return [...this.users.values()].find((u) => u.phone === phone) ?? null;
  }
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async createPhoneUser(phone: string) {
    const user = baseUser({ id: randomUUID(), phone });
    this.users.set(user.id, user);
    return user;
  }
  async createAdminUser(email: string, passwordHash: string, firstName: string, lastName: string) {
    const user = baseUser({ id: randomUUID(), email, passwordHash, firstName, lastName });
    this.users.set(user.id, user);
    return user;
  }
  async updateUserProfile(id: string, firstName: string, lastName: string) {
    const user = this.users.get(id);
    if (!user) return null;
    user.firstName = firstName; user.lastName = lastName;
    return user;
  }
  async setMfa(id: string, secret: string | null, enabled: boolean) {
    const user = this.users.get(id);
    if (!user) return null;
    user.mfaSecret = secret; user.mfaEnabled = enabled;
    return user;
  }
  async markPhoneVerified(id: string) {
    const user = this.users.get(id);
    if (user) user.phoneVerifiedAt = new Date();
  }
  async createOtp(phone: string, codeHash: string, expiresAt: Date) {
    const otp: OtpRecord = { id: randomUUID(), phone, codeHash, attempts: 0, expiresAt, consumedAt: null };
    this.otps.push(otp);
    return otp;
  }
  async getLatestOtp(phone: string) {
    const list = this.otps.filter((o) => o.phone === phone && !o.consumedAt);
    return list.length ? list[list.length - 1] : null;
  }
  async incrementOtpAttempts(id: string) {
    const otp = this.otps.find((o) => o.id === id);
    if (otp) otp.attempts += 1;
  }
  async consumeOtp(id: string) {
    const otp = this.otps.find((o) => o.id === id);
    if (otp) otp.consumedAt = new Date();
  }
  async createSession(userId: string, refreshTokenHash: string, expiresAt: Date) {
    const session: SessionRecord = { id: randomUUID(), userId, refreshTokenHash, revokedAt: null, expiresAt };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSessionByHash(hash: string) {
    return [...this.sessions.values()].find((s) => s.refreshTokenHash === hash) ?? null;
  }
  async revokeSession(id: string) {
    const s = this.sessions.get(id);
    if (s) s.revokedAt = new Date();
  }
  async revokeAllSessions(userId: string) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) s.revokedAt = new Date();
    }
  }
  async listRoles() { return [...this.roles.values()]; }
  async createRole(name: string) {
    const existing = [...this.roles.values()].find((r) => r.name === name);
    if (existing) return existing;
    const role: RoleRecord = { id: randomUUID(), name, permissionNames: [] };
    this.roles.set(role.id, role);
    return role;
  }
  async addPermissionToRole(roleId: string, permissionName: string) {
    const role = this.roles.get(roleId);
    if (!role) return null;
    if (!role.permissionNames.includes(permissionName)) role.permissionNames.push(permissionName);
    return role;
  }
  async assignRoleToUser(userId: string, roleId: string) {
    if (!this.userRoles.has(userId)) this.userRoles.set(userId, new Set());
    this.userRoles.get(userId)!.add(roleId);
  }
  async getRolesForUser(userId: string) {
    const ids = this.userRoles.get(userId) ?? new Set<string>();
    return [...ids].map((id) => this.roles.get(id)!).filter(Boolean);
  }
  async getPermissionsForUser(userId: string) {
    const roles = await this.getRolesForUser(userId);
    return [...new Set(roles.flatMap((r) => r.permissionNames))];
  }

  // ---- Driver / KYC (Phase 5) ----
  driverProfiles = new Map<string, DriverProfileRecord>();
  driverDocuments = new Map<string, DriverDocumentRecord>();
  vehicles = new Map<string, VehicleRecord>();
  driverHistory: DriverHistoryRecord[] = [];

  async getDriverProfile(userId: string) { return this.driverProfiles.get(userId) ?? null; }
  async createDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null) {
    const existing = this.driverProfiles.get(userId);
    if (existing) return existing;
    const profile: DriverProfileRecord = { userId, kycStatus: 'DRAFT', rejectionReason: null, emergencyContactName, emergencyContactPhone, bankAccount };
    this.driverProfiles.set(userId, profile);
    return profile;
  }
  async updateDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null) {
    const profile = this.driverProfiles.get(userId);
    if (!profile) return null;
    profile.emergencyContactName = emergencyContactName;
    profile.emergencyContactPhone = emergencyContactPhone;
    profile.bankAccount = bankAccount;
    return profile;
  }
  async setDriverKycStatus(userId: string, status: string, reason: string | null) {
    const profile = this.driverProfiles.get(userId);
    if (!profile) return null;
    profile.kycStatus = status;
    profile.rejectionReason = reason;
    return profile;
  }
  async listDriverProfilesByKyc(status: string) {
    return [...this.driverProfiles.values()].filter((p) => p.kycStatus === status);
  }
  async addDriverDocument(doc: Omit<DriverDocumentRecord, 'id'>) {
    const record: DriverDocumentRecord = { id: randomUUID(), ...doc };
    this.driverDocuments.set(record.id, record);
    return record;
  }
  async getDriverDocument(id: string) { return this.driverDocuments.get(id) ?? null; }
  async listDriverDocuments(userId: string) {
    return [...this.driverDocuments.values()].filter((d) => d.driverUserId === userId);
  }
  async addDriverHistory(entry: Omit<DriverHistoryRecord, 'createdAt'>) {
    this.driverHistory.push({ ...entry, createdAt: new Date() });
  }
  async listDriverHistory(userId: string) {
    return this.driverHistory.filter((h) => h.driverUserId === userId);
  }
  async createVehicle(v: Omit<VehicleRecord, 'id' | 'approvalStatus' | 'isActive'>) {
    const vehicle: VehicleRecord = { id: randomUUID(), approvalStatus: 'DRAFT', isActive: false, ...v };
    this.vehicles.set(vehicle.id, vehicle);
    return vehicle;
  }
  async listVehiclesByOwner(userId: string) {
    return [...this.vehicles.values()].filter((v) => v.ownerUserId === userId);
  }
  async getVehicle(id: string) { return this.vehicles.get(id) ?? null; }
  async setVehicleApproval(id: string, status: string) {
    const vehicle = this.vehicles.get(id);
    if (!vehicle) return null;
    vehicle.approvalStatus = status;
    return vehicle;
  }
  async setActiveVehicle(userId: string, vehicleId: string) {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle || vehicle.ownerUserId !== userId) return null;
    for (const v of this.vehicles.values()) {
      if (v.ownerUserId === userId) v.isActive = false;
    }
    vehicle.isActive = true;
    return vehicle;
  }
  // ---- Rides / pricing (Phase 6) ----
  cities = new Map<string, CityRecord>();
  pricingRules: PricingRuleRecord[] = [];
  rideRequests = new Map<string, RideRequestRecord>();
  requestHistory: RequestHistoryRecord[] = [];

  async createCity(city: Omit<CityRecord, 'id'>) {
    const record: CityRecord = { id: randomUUID(), ...city, isActive: city.isActive ?? true };
    this.cities.set(record.id, record);
    return record;
  }
  async listCities() { return [...this.cities.values()]; }
  async createPricingRule(rule: Omit<PricingRuleRecord, 'id'>) {
    const record: PricingRuleRecord = { id: randomUUID(), ...rule };
    this.pricingRules.push(record);
    return record;
  }
  async getPricingRule(cityId: string | null, serviceCode: string) {
    const byCity = this.pricingRules.filter((r) => r.serviceCode === serviceCode && r.cityId === cityId);
    if (byCity.length > 0) return byCity[byCity.length - 1];
    const global = this.pricingRules.filter((r) => r.serviceCode === serviceCode && r.cityId === null);
    return global.length > 0 ? global[global.length - 1] : null;
  }
  async createRideRequest(r: Omit<RideRequestRecord, 'id' | 'createdAt'>) {
    const record: RideRequestRecord = { id: randomUUID(), createdAt: new Date(), ...r };
    this.rideRequests.set(record.id, record);
    return record;
  }
  async getRideRequest(id: string) { return this.rideRequests.get(id) ?? null; }
  async listRideRequestsByCustomer(customerId: string) {
    return [...this.rideRequests.values()].filter((r) => r.customerId === customerId);
  }
  async setRideRequestStatus(id: string, status: string) {
    const record = this.rideRequests.get(id);
    if (!record) return null;
    record.status = status;
    return record;
  }
  async addRequestHistory(entry: Omit<RequestHistoryRecord, 'createdAt'>) {
    this.requestHistory.push({ ...entry, createdAt: new Date() });
  }
  async listRequestHistory(requestId: string) {
    return this.requestHistory.filter((h) => h.requestId === requestId);
  }

  // ---- Dispatch stats / attempts (Phase 7) ----
  driverStats = new Map<string, DriverStatsRecord>();
  dispatchAttempts: DispatchAttemptRecord[] = [];

  async getDriverStats(driverUserId: string) {
    return this.driverStats.get(driverUserId) ?? {
      driverUserId, tripsToday: 0, offersSent: 0, offersAccepted: 0, ratingSum: 0, ratingCount: 0,
    };
  }
  async setDriverStats(stats: DriverStatsRecord) {
    this.driverStats.set(stats.driverUserId, stats);
  }
  async incrementOfferSent(driverUserId: string) {
    const stats = await this.getDriverStats(driverUserId);
    stats.offersSent += 1;
    this.driverStats.set(driverUserId, stats);
  }
  async addDispatchAttempt(attempt: DispatchAttemptRecord) {
    this.dispatchAttempts.push({ ...attempt, createdAt: attempt.createdAt ?? new Date() });
  }
  async listDispatchAttempts(requestId: string) {
    return this.dispatchAttempts.filter((a) => a.requestId === requestId);
  }
  async getDeclinedDriverIds(requestId: string) {
    return this.dispatchAttempts
      .filter((a) => a.requestId === requestId && (a.outcome === 'DECLINED' || a.outcome === 'TIMEOUT'))
      .map((a) => a.driverUserId);
  }

  // ---- Offers / rides (Phase 8) ----
  offers = new Map<string, OfferRecord>();
  rides = new Map<string, RideRecord>();

  async createOffer(offer: Omit<OfferRecord, 'id' | 'createdAt'>) {
    const record: OfferRecord = { id: randomUUID(), createdAt: new Date(), ...offer };
    this.offers.set(record.id, record);
    return record;
  }
  async getOffer(id: string) { return this.offers.get(id) ?? null; }
  async listOffersByRequest(requestId: string) {
    return [...this.offers.values()].filter((o) => o.requestId === requestId);
  }
  async setOfferStatus(id: string, status: string) {
    const offer = this.offers.get(id);
    if (!offer) return null;
    offer.status = status;
    return offer;
  }
  async updateOfferFare(id: string, fareMinor: number, counterCount: number) {
    const offer = this.offers.get(id);
    if (!offer) return null;
    offer.proposedFareMinor = fareMinor;
    offer.counterCount = counterCount;
    return offer;
  }
  async createRide(ride: Omit<RideRecord, 'id' | 'createdAt'>) {
    const record: RideRecord = { id: randomUUID(), createdAt: new Date(), ...ride };
    this.rides.set(record.id, record);
    return record;
  }
  async getRideByRequestId(requestId: string) {
    return [...this.rides.values()].find((r) => r.requestId === requestId) ?? null;
  }
  async getRideById(id: string) { return this.rides.get(id) ?? null; }
  async getActiveRideForDriver(driverId: string) {
    const active = ['DRIVER_SELECTED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'WAITING_FOR_PIN', 'IN_PROGRESS'];
    return [...this.rides.values()]
      .filter((r) => r.driverId === driverId && active.includes(r.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  async setDispatchAttemptOutcome(requestId: string, driverId: string, outcome: string) {
    for (const attempt of this.dispatchAttempts) {
      if (attempt.requestId === requestId && attempt.driverUserId === driverId && attempt.outcome === 'OFFERED') {
        attempt.outcome = outcome;
      }
    }
  }
  async incrementOffersAccepted(driverId: string) {
    const stats = await this.getDriverStats(driverId);
    stats.offersAccepted += 1;
    this.driverStats.set(driverId, stats);
  }
  async listOpenRequestsForDriver(driverId: string) {
    const requestIds = new Set(
      this.dispatchAttempts
        .filter((a) => a.driverUserId === driverId && a.outcome === 'OFFERED')
        .map((a) => a.requestId),
    );
    return [...this.rideRequests.values()].filter((r) => requestIds.has(r.id) && r.status === 'OFFERING');
  }

  // ---- Live tracking (Phase 9) ----
  rideLocations = new Map<string, RideLocationRecord[]>();

  async addRideLocation(location: Omit<RideLocationRecord, 'recordedAt'>) {
    const record: RideLocationRecord = { ...location, recordedAt: new Date() };
    const list = this.rideLocations.get(location.rideId) ?? [];
    list.push(record);
    this.rideLocations.set(location.rideId, list);
    return record;
  }
  async getLatestRideLocation(rideId: string) {
    const list = this.rideLocations.get(rideId) ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
  }
  async listRideLocations(rideId: string, limit: number) {
    const list = this.rideLocations.get(rideId) ?? [];
    return list.slice(-limit);
  }

  // ---- Trip lifecycle (Phase 10) ----
  rideHistory: RideHistoryRecord[] = [];
  ridePins = new Map<string, RidePinRecord>();

  async setRideStatus(rideId: string, status: string) {
    const ride = this.rides.get(rideId);
    if (!ride) return null;
    ride.status = status;
    return ride;
  }
  async addRideHistory(entry: Omit<RideHistoryRecord, 'createdAt'>) {
    this.rideHistory.push({ ...entry, createdAt: new Date() });
  }
  async listRideHistory(rideId: string) {
    return this.rideHistory.filter((h) => h.rideId === rideId);
  }
  async createRidePin(pin: RidePinRecord) {
    this.ridePins.set(pin.rideId, pin);
  }
  async getRidePin(rideId: string) {
    return this.ridePins.get(rideId) ?? null;
  }
  async incrementPinAttempts(rideId: string) {
    const pin = this.ridePins.get(rideId);
    if (!pin) return null;
    pin.attempts += 1;
    return pin;
  }
  async setPinVerified(rideId: string) {
    const pin = this.ridePins.get(rideId);
    if (pin) pin.verifiedAt = new Date();
  }

  // ---- Delivery (Phase 11) ----
  deliveryRequestDetails = new Map<string, DeliveryRequestDetails>();
  deliveryDetails = new Map<string, DeliveryDetails>();
  deliveryHistory: DeliveryHistoryRecord[] = [];
  deliveryProofs = new Map<string, DeliveryProofRecord>();

  async createDeliveryRequestDetails(details: DeliveryRequestDetails) {
    this.deliveryRequestDetails.set(details.requestId, details);
  }
  async getDeliveryRequestDetails(requestId: string) {
    return this.deliveryRequestDetails.get(requestId) ?? null;
  }
  async createDeliveryDetails(details: DeliveryDetails) {
    this.deliveryDetails.set(details.rideId, details);
  }
  async getDeliveryDetails(rideId: string) {
    return this.deliveryDetails.get(rideId) ?? null;
  }
  async setDeliveryStatus(rideId: string, status: string) {
    const details = this.deliveryDetails.get(rideId);
    if (!details) return null;
    details.status = status;
    return details;
  }
  async addDeliveryHistory(entry: Omit<DeliveryHistoryRecord, 'createdAt'>) {
    this.deliveryHistory.push({ ...entry, createdAt: new Date() });
  }
  async listDeliveryHistory(rideId: string) {
    return this.deliveryHistory.filter((h) => h.rideId === rideId);
  }
  async createDeliveryProof(proof: Omit<DeliveryProofRecord, 'id' | 'createdAt'>) {
    const record: DeliveryProofRecord = { id: randomUUID(), createdAt: new Date(), ...proof };
    this.deliveryProofs.set(record.id, record);
    return record;
  }
  async listDeliveryProofs(rideId: string) {
    return [...this.deliveryProofs.values()].filter((p) => p.rideId === rideId);
  }
  async getDeliveryProofById(id: string) {
    return this.deliveryProofs.get(id) ?? null;
  }
  async getDeliveryOtpProof(rideId: string) {
    const matches = [...this.deliveryProofs.values()].filter((p) => p.rideId === rideId && p.proofType === 'OTP');
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }
  async incrementDeliveryProofAttempts(id: string) {
    const proof = this.deliveryProofs.get(id);
    if (!proof) return null;
    proof.attempts += 1;
    return proof;
  }
  async setDeliveryProofVerified(id: string, verifiedBy: string) {
    const proof = this.deliveryProofs.get(id);
    if (proof) proof.verifiedBy = verifiedBy;
  }

  // ---- Payments / wallet / commission (Phase 12) ----
  walletAccounts = new Map<string, WalletAccountRecord>();
  ledgerEntries: LedgerEntryRecord[] = [];
  payments = new Map<string, PaymentRecord>();
  commissionRules: CommissionRuleRecord[] = [];
  topups = new Map<string, TopupRecord>();
  withdrawals = new Map<string, WithdrawalRecord>();
  refunds: RefundRecord[] = [];
  settings = new Map<string, string>();

  private accountKey(ownerType: string, ownerId: string | null, currency: string) {
    return `${ownerType}:${ownerId ?? 'platform'}:${currency}`;
  }
  async getOrCreateAccount(ownerType: string, ownerId: string | null, currency: string) {
    const key = this.accountKey(ownerType, ownerId, currency);
    let account = this.walletAccounts.get(key);
    if (!account) {
      account = { id: randomUUID(), ownerType, ownerId, currency };
      this.walletAccounts.set(key, account);
    }
    return account;
  }
  async getBalance(ownerType: string, ownerId: string | null) {
    const account = await this.getOrCreateAccount(ownerType, ownerId, 'PKR');
    return this.ledgerEntries
      .filter((e) => e.accountId === account.id)
      .reduce((sum, e) => sum + e.amountMinor, 0);
  }
  async createLedgerEntry(entry: Omit<LedgerEntryRecord, 'id' | 'createdAt'>) {
    if (entry.idempotencyKey) {
      const existing = this.ledgerEntries.find((e) => e.idempotencyKey === entry.idempotencyKey);
      if (existing) return existing;
    }
    const record: LedgerEntryRecord = { id: randomUUID(), createdAt: new Date(), ...entry };
    this.ledgerEntries.push(record);
    return record;
  }
  async listLedgerEntries(ownerType: string, ownerId: string | null, limit: number) {
    const account = await this.getOrCreateAccount(ownerType, ownerId, 'PKR');
    return this.ledgerEntries
      .filter((e) => e.accountId === account.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>) {
    if (payment.idempotencyKey) {
      const existing = [...this.payments.values()].find((p) => p.idempotencyKey === payment.idempotencyKey);
      if (existing) return existing;
    }
    const record: PaymentRecord = { id: randomUUID(), createdAt: new Date(), ...payment };
    this.payments.set(record.id, record);
    return record;
  }
  async getPaymentByRideId(rideId: string) {
    return [...this.payments.values()].find((p) => p.rideId === rideId) ?? null;
  }
  async getPaymentById(id: string) { return this.payments.get(id) ?? null; }
  async setPaymentStatus(id: string, status: string) {
    const payment = this.payments.get(id);
    if (!payment) return null;
    payment.status = status;
    return payment;
  }
  async setRideCommission(rideId: string, commissionMinor: number, ruleVersion: number) {
    const ride = this.rides.get(rideId);
    if (ride) {
      ride.commissionMinor = commissionMinor;
      ride.commissionRuleVersion = ruleVersion;
    }
  }
  async createCommissionRule(rule: Omit<CommissionRuleRecord, 'id'>) {
    const record: CommissionRuleRecord = { id: randomUUID(), ...rule };
    this.commissionRules.push(record);
    return record;
  }
  async listCommissionRules() { return [...this.commissionRules]; }
  async resolveCommissionRule(driverUserId: string, cityId: string | null, serviceCode: string) {
    const byDriver = this.commissionRules.filter((r) => r.scope === 'DRIVER' && r.driverUserId === driverUserId);
    if (byDriver.length > 0) return byDriver[byDriver.length - 1];
    const byServiceCity = this.commissionRules.filter((r) => r.scope === 'SERVICE_CITY' && r.cityId === cityId && r.serviceCode === serviceCode);
    if (byServiceCity.length > 0) return byServiceCity[byServiceCity.length - 1];
    const byCity = this.commissionRules.filter((r) => r.scope === 'CITY' && r.cityId === cityId);
    if (byCity.length > 0) return byCity[byCity.length - 1];
    const global = this.commissionRules.filter((r) => r.scope === 'GLOBAL');
    return global.length > 0 ? global[global.length - 1] : null;
  }
  async createTopup(topup: Omit<TopupRecord, 'id' | 'createdAt'>) {
    const record: TopupRecord = { id: randomUUID(), createdAt: new Date(), ...topup };
    this.topups.set(record.id, record);
    return record;
  }
  async getTopup(id: string) { return this.topups.get(id) ?? null; }
  async listTopups(userId: string) {
    return [...this.topups.values()].filter((t) => t.userId === userId);
  }
  async setTopupStatus(id: string, status: string, reviewedBy: string) {
    const topup = this.topups.get(id);
    if (!topup) return null;
    topup.status = status;
    topup.reviewedBy = reviewedBy;
    return topup;
  }
  async createWithdrawal(w: Omit<WithdrawalRecord, 'id' | 'createdAt'>) {
    const record: WithdrawalRecord = { id: randomUUID(), createdAt: new Date(), ...w };
    this.withdrawals.set(record.id, record);
    return record;
  }
  async getWithdrawal(id: string) { return this.withdrawals.get(id) ?? null; }
  async listWithdrawals(userId: string) {
    return [...this.withdrawals.values()].filter((w) => w.userId === userId);
  }
  async setWithdrawalStatus(id: string, status: string, reviewedBy: string, payoutReference: string | null) {
    const record = this.withdrawals.get(id);
    if (!record) return null;
    record.status = status;
    record.reviewedBy = reviewedBy;
    record.payoutReference = payoutReference;
    return record;
  }
  async createRefund(refund: Omit<RefundRecord, 'id' | 'createdAt'>) {
    const record: RefundRecord = { id: randomUUID(), createdAt: new Date(), ...refund };
    this.refunds.push(record);
    return record;
  }
  async listRefundsByPayment(paymentId: string) {
    return this.refunds.filter((r) => r.paymentId === paymentId);
  }
  async getSetting(key: string) { return this.settings.get(key) ?? null; }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }

  // ---- Admin (Phase 13) ----
  async setCityActive(id: string, isActive: boolean) {
    const city = this.cities.get(id);
    if (!city) return null;
    city.isActive = isActive;
    return city;
  }
  async listPricingRules() { return [...this.pricingRules]; }
  serviceTypeOverrides = new Map<string, CatalogRecord>();
  vehicleCategoryOverrides = new Map<string, CatalogRecord>();
  async listServiceTypes() {
    return mergeCatalog(DEFAULT_SERVICES, [...this.serviceTypeOverrides.values()]);
  }
  async upsertServiceType(record: CatalogRecord) {
    this.serviceTypeOverrides.set(record.code, record);
    return record;
  }
  async listVehicleCategories() {
    return mergeCatalog(DEFAULT_VEHICLE_CATEGORIES, [...this.vehicleCategoryOverrides.values()]);
  }
  async upsertVehicleCategory(record: CatalogRecord) {
    this.vehicleCategoryOverrides.set(record.code, record);
    return record;
  }
  auditLogs: AuditLogRecord[] = [];
  async addAuditLog(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>) {
    const record: AuditLogRecord = { id: randomUUID(), createdAt: new Date(), ...entry };
    this.auditLogs.push(record);
    return record;
  }
  async listAuditLogs(limit: number) {
    return [...this.auditLogs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  // ---- Support / safety (Phase 14) ----
  ratings: RatingRecord[] = [];
  tickets = new Map<string, SupportTicketRecord>();
  ticketMessages: TicketMessageRecord[] = [];
  incidents = new Map<string, SafetyIncidentRecord>();
  shareLinks = new Map<string, ShareLinkRecord>();

  async createRating(rating: Omit<RatingRecord, 'id' | 'createdAt'>) {
    const existing = this.ratings.find((r) => r.rideId === rating.rideId && r.raterRole === rating.raterRole);
    if (existing) throw new Error('DUPLICATE_RATING');
    const record: RatingRecord = { id: randomUUID(), createdAt: new Date(), ...rating };
    this.ratings.push(record);
    return record;
  }
  async getRatingByRideAndRole(rideId: string, raterRole: string) {
    return this.ratings.find((r) => r.rideId === rideId && r.raterRole === raterRole) ?? null;
  }
  async createTicket(ticket: Omit<SupportTicketRecord, 'id' | 'createdAt'>) {
    const record: SupportTicketRecord = { id: randomUUID(), createdAt: new Date(), ...ticket };
    this.tickets.set(record.id, record);
    return record;
  }
  async getTicket(id: string) { return this.tickets.get(id) ?? null; }
  async listTickets(reporterUserId: string | null, status: string | null) {
    return [...this.tickets.values()].filter((t) =>
      (reporterUserId === null || t.reporterUserId === reporterUserId) &&
      (status === null || t.status === status));
  }
  async setTicketStatus(id: string, status: string) {
    const ticket = this.tickets.get(id);
    if (!ticket) return null;
    ticket.status = status;
    return ticket;
  }
  async addTicketMessage(message: Omit<TicketMessageRecord, 'id' | 'createdAt'>) {
    const record: TicketMessageRecord = { id: randomUUID(), createdAt: new Date(), ...message };
    this.ticketMessages.push(record);
    return record;
  }
  async listTicketMessages(ticketId: string) {
    return this.ticketMessages.filter((m) => m.ticketId === ticketId);
  }
  async createIncident(incident: Omit<SafetyIncidentRecord, 'id' | 'createdAt'>) {
    const record: SafetyIncidentRecord = { id: randomUUID(), createdAt: new Date(), ...incident };
    this.incidents.set(record.id, record);
    return record;
  }
  async getOpenIncidentByRide(rideId: string) {
    return [...this.incidents.values()].find((i) => i.rideId === rideId && i.status === 'OPEN') ?? null;
  }
  async getIncident(id: string) { return this.incidents.get(id) ?? null; }
  async listIncidents(status: string | null) {
    return [...this.incidents.values()].filter((i) => status === null || i.status === status);
  }
  async resolveIncident(id: string, resolutionNote: string) {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    incident.status = 'RESOLVED';
    incident.resolutionNote = resolutionNote;
    return incident;
  }
  async createShareLink(link: Omit<ShareLinkRecord, 'id' | 'createdAt'>) {
    const record: ShareLinkRecord = { id: randomUUID(), createdAt: new Date(), ...link };
    this.shareLinks.set(record.id, record);
    return record;
  }
  async getShareLinkByTokenHash(tokenHash: string) {
    return [...this.shareLinks.values()].find((l) => l.tokenHash === tokenHash) ?? null;
  }
  async listShareLinksByRide(rideId: string) {
    return [...this.shareLinks.values()].filter((l) => l.rideId === rideId);
  }
  async revokeShareLink(id: string) {
    const link = this.shareLinks.get(id);
    if (!link) return null;
    link.revokedAt = new Date();
    return link;
  }
  async listCancelledRides(since: Date): Promise<CancelledRideEntry[]> {
    const out: CancelledRideEntry[] = [];
    for (const ride of this.rides.values()) {
      if (!ride.status.startsWith('CANCELLED')) continue;
      const history = await this.listRideHistory(ride.id);
      const cancel = [...history].reverse().find((h) => h.toStatus === ride.status);
      if (!cancel || cancel.createdAt < since) continue;
      out.push({
        rideId: ride.id, customerId: ride.customerId, driverId: ride.driverId,
        status: ride.status, actorId: cancel.actorId, actorRole: cancel.actorRole,
        reason: cancel.reason, cancelledAt: cancel.createdAt,
      });
    }
    return out.sort((a, b) => b.cancelledAt.getTime() - a.cancelledAt.getTime());
  }
  async countCancelsByActorSince(actorId: string, since: Date) {
    return this.rideHistory.filter((h) =>
      h.actorId === actorId && h.toStatus.startsWith('CANCELLED') && h.createdAt >= since).length;
  }
  async setUserStatus(id: string, status: string, reason: string | null) {
    const user = this.users.get(id);
    if (!user) return null;
    user.status = status;
    (user as any).suspensionReason = reason;
    return user;
  }


  // ---- Analytics (Phase 15; on-read aggregates, no separate ETL) ----
  private dayKey(d: Date) { return d.toISOString().slice(0, 10); }
  async getRideStats(since: Date): Promise<RideStats> {
    const requests = [...this.rideRequests.values()].filter((r) => r.createdAt >= since);
    const completed = [...this.rides.values()].filter((r) => r.status === 'COMPLETED');
    const completedInPeriod = completed.filter((r) => {
      const h = this.rideHistory.find((x) => x.rideId === r.id && x.toStatus === 'COMPLETED');
      return h ? h.createdAt >= since : r.createdAt >= since;
    });
    const fares = completedInPeriod.map((r) => r.finalFareMinor ?? 0).filter((f) => f > 0);
    return {
      requested: requests.length,
      completed: completedInPeriod.length,
      // Requests carry the mirrored status for matched cancels too,
      // so counting requests alone covers pre- and post-match cancels
      // without double-counting.
      cancelled: requests.filter((r) => r.status.startsWith('CANCELLED')).length,
      noDriverFound: requests.filter((r) => r.status === 'NO_DRIVER_FOUND').length,
      avgFareMinor: fares.length > 0 ? Math.round(fares.reduce((a, b) => a + b, 0) / fares.length) : null,
      totalCommissionMinor: completedInPeriod.reduce((sum, r) => sum + (r.commissionMinor ?? 0), 0),
    };
  }
  async getDispatchStats(since: Date): Promise<DispatchStats> {
    const attempts = this.dispatchAttempts.filter((a) => (a.createdAt ?? new Date(0)) >= since);
    const byOutcome: Record<string, number> = {};
    const byRadius: Record<string, number> = {};
    for (const a of attempts) {
      byOutcome[a.outcome] = (byOutcome[a.outcome] ?? 0) + 1;
      byRadius[String(a.radiusKm)] = (byRadius[String(a.radiusKm)] ?? 0) + 1;
    }
    const scores = attempts.map((a) => a.score);
    const offers = [...this.offers.values()].filter((o) => o.createdAt >= since);
    // Average match time: SEARCHING entry to DRIVER_SELECTED entry.
    const matchSeconds: number[] = [];
    for (const req of this.rideRequests.values()) {
      const history = this.requestHistory.filter((h) => h.requestId === req.id);
      const searching = history.find((h) => h.toStatus === 'SEARCHING');
      const selected = history.find((h) => h.toStatus === 'DRIVER_SELECTED');
      if (searching && selected && selected.createdAt >= since) {
        matchSeconds.push((selected.createdAt.getTime() - searching.createdAt.getTime()) / 1000);
      }
    }
    return {
      attempts: attempts.length,
      byOutcome,
      avgScore: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10000) / 10000 : null,
      byRadius,
      avgMatchSeconds: matchSeconds.length > 0
        ? Math.round((matchSeconds.reduce((a, b) => a + b, 0) / matchSeconds.length) * 100) / 100 : null,
      offersSent: offers.length,
      offersAccepted: offers.filter((o) => o.status === 'ACCEPTED').length,
    };
  }
  async getCityStats(since: Date): Promise<CityStatRow[]> {
    const rows: CityStatRow[] = [];
    for (const city of this.cities.values()) {
      const requests = [...this.rideRequests.values()].filter((r) => r.cityId === city.id && r.createdAt >= since);
      const rides = [...this.rides.values()].filter((r) => {
        const req = this.rideRequests.get(r.requestId);
        return req?.cityId === city.id;
      });
      const completed = rides.filter((r) => {
        if (r.status !== 'COMPLETED') return false;
        const h = this.rideHistory.find((x) => x.rideId === r.id && x.toStatus === 'COMPLETED');
        return h ? h.createdAt >= since : r.createdAt >= since;
      });
      const fares = completed.map((r) => r.finalFareMinor ?? 0).filter((f) => f > 0);
      rows.push({
        cityId: city.id, cityName: city.name,
        requested: requests.length, completed: completed.length,
        cancelled: requests.filter((r) => r.status.startsWith('CANCELLED')).length,
        commissionMinor: completed.reduce((sum, r) => sum + (r.commissionMinor ?? 0), 0),
        avgFareMinor: fares.length > 0 ? Math.round(fares.reduce((a, b) => a + b, 0) / fares.length) : null,
      });
    }
    return rows;
  }
  async getDriverLeaderboard(since: Date, limit: number): Promise<DriverLeaderRow[]> {
    const rows: DriverLeaderRow[] = [];
    const driverIds = new Set([...this.rides.values()].map((r) => r.driverId).filter((d): d is string => d !== null));
    for (const driverId of driverIds) {
      const completed = [...this.rides.values()].filter((r) => r.driverId === driverId && r.status === 'COMPLETED' &&
        (() => {
          const h = this.rideHistory.find((x) => x.rideId === r.id && x.toStatus === 'COMPLETED');
          return h ? h.createdAt >= since : r.createdAt >= since;
        })());
      if (completed.length === 0) continue;
      const driverRatings = this.ratings.filter((x) => x.ratedUserId === driverId && x.createdAt >= since);
      const offers = [...this.offers.values()].filter((o) => o.driverId === driverId && o.createdAt >= since);
      const accepted = offers.filter((o) => o.status === 'ACCEPTED').length;
      rows.push({
        driverUserId: driverId,
        completedRides: completed.length,
        earningsMinor: completed.reduce((sum, r) => sum + ((r.finalFareMinor ?? 0) - (r.commissionMinor ?? 0)), 0),
        avgRating: driverRatings.length > 0
          ? Math.round((driverRatings.reduce((a, b) => a + b.stars, 0) / driverRatings.length) * 100) / 100 : null,
        acceptanceRate: offers.length > 0 ? Math.round((accepted / offers.length) * 100) / 100 : null,
      });
    }
    rows.sort((a, b) => b.completedRides - a.completedRides || b.earningsMinor - a.earningsMinor);
    return rows.slice(0, limit);
  }
  async getDailySeries(since: Date): Promise<DailyRow[]> {
    const byDay = new Map<string, DailyRow>();
    for (const req of this.rideRequests.values()) {
      if (req.createdAt < since) continue;
      const key = this.dayKey(req.createdAt);
      const row = byDay.get(key) ?? { date: key, requested: 0, completed: 0, commissionMinor: 0 };
      row.requested += 1;
      byDay.set(key, row);
    }
    for (const ride of this.rides.values()) {
      if (ride.status !== 'COMPLETED') continue;
      const h = this.rideHistory.find((x) => x.rideId === ride.id && x.toStatus === 'COMPLETED');
      const when = h ? h.createdAt : ride.createdAt;
      if (when < since) continue;
      const key = this.dayKey(when);
      const row = byDay.get(key) ?? { date: key, requested: 0, completed: 0, commissionMinor: 0 };
      row.completed += 1;
      row.commissionMinor += ride.commissionMinor ?? 0;
      byDay.set(key, row);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async getDriverTripsInCityToday(driverUserId: string, cityId: string, dayStart: Date): Promise<number> {
    let count = 0;
    for (const h of this.rideHistory) {
      if (h.toStatus !== 'COMPLETED' || h.createdAt < dayStart) continue;
      const ride = this.rides.get(h.rideId);
      if (!ride || ride.driverId !== driverUserId) continue;
      const req = this.rideRequests.get(ride.requestId);
      if (req?.cityId === cityId) count += 1;
    }
    return count;
  }
  async getCityFairness(cityId: string, dayStart: Date): Promise<CityFairness> {
    const perDriver = new Map<string, number>();
    for (const h of this.rideHistory) {
      if (h.toStatus !== 'COMPLETED' || h.createdAt < dayStart) continue;
      const ride = this.rides.get(h.rideId);
      if (!ride?.driverId) continue;
      const req = this.rideRequests.get(ride.requestId);
      if (req?.cityId !== cityId) continue;
      perDriver.set(ride.driverId, (perDriver.get(ride.driverId) ?? 0) + 1);
    }
    const drivers = [...perDriver.entries()].map(([driverUserId, tripsToday]) => ({ driverUserId, tripsToday }));
    return {
      cityId,
      cityMaxTripsToday: drivers.reduce((max, d) => Math.max(max, d.tripsToday), 0),
      drivers: drivers.sort((a, b) => b.tripsToday - a.tripsToday),
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async getAdminOverview(): Promise<AdminOverview> {
    const countBy = (values: string[]) => {
      const out: Record<string, number> = {};
      for (const v of values) out[v] = (out[v] ?? 0) + 1;
      return out;
    };
    const cities = [...this.cities.values()];
    return {
      usersTotal: this.users.size,
      driversByKyc: countBy([...this.driverProfiles.values()].map((p) => p.kycStatus)),
      ridesByStatus: countBy([...this.rides.values()].map((r) => r.status)),
      paymentsByStatus: countBy([...this.payments.values()].map((p) => p.status)),
      commissionBalanceMinor: await this.getBalance('COMMISSION', null),
      pendingTopups: [...this.topups.values()].filter((t) => t.status === 'PENDING').length,
      pendingWithdrawals: [...this.withdrawals.values()].filter((w) => w.status === 'PENDING').length,
      citiesTotal: cities.length,
      activeCities: cities.filter((c) => c.isActive).length,
    };
  }
}
