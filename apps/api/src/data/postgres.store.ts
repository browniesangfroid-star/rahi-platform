import { Pool } from 'pg';
import { mergeCatalog, DEFAULT_SERVICES, DEFAULT_VEHICLE_CATEGORIES } from './store.interface.js';
import type { AdminOverview, AuditLogRecord, AcceptOfferTxInput, AcceptOfferTxResult, CancelledRideEntry, CatalogRecord, CityFairness, CityStatRow, DailyRow, DispatchStats, DriverLeaderRow, CityRecord, CommissionRuleRecord, DeliveryDetails, DeliveryHistoryRecord, DeliveryProofRecord, DeliveryRequestDetails, DispatchAttemptRecord, LedgerEntryRecord, OfferRecord, PaymentRecord, RefundRecord, RideHistoryRecord, RideLocationRecord, RidePinRecord, RideRecord, RideStats, RatingRecord, SafetyIncidentRecord, ShareLinkRecord, SupportTicketRecord, TicketMessageRecord, TopupRecord, WalletAccountRecord, WithdrawalRecord, DriverDocumentRecord, DriverHistoryRecord, DriverProfileRecord, DriverStatsRecord, OtpRecord, PricingRuleRecord, RequestHistoryRecord, RideRequestRecord, RoleRecord, SessionRecord, Store, UserRecord, VehicleRecord } from './store.interface';

/**
 * Production store. SQL is parameterised throughout. It is implemented
 * against migrations 001-003 and is NOT live-tested in the VM used for
 * Phase 3 (no Postgres there) — run `scripts/run-migrations.sh` and the
 * e2e suite against a real Postgres before relying on it in staging.
 */
export class PostgresStore implements Store {
  private pool: Pool;
  constructor(connectionString: string) {
    // Hosted Postgres (e.g. Render's EXTERNAL url) requires SSL; the
    // internal Render url does not. Opt in with PG_SSL=true when the
    // database is reached over the public internet. Default stays
    // unchanged (no SSL) so local/docker setups are unaffected.
    const useSsl = process.env.PG_SSL === 'true';
    this.pool = new Pool(useSsl
      ? { connectionString, ssl: { rejectUnauthorized: false } }
      : { connectionString });
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async mapUser(row: any): Promise<UserRecord> {
    return {
      id: row.id, phone: row.phone, email: row.email,
      passwordHash: row.password_hash ?? null, status: row.status,
      phoneVerifiedAt: row.phone_verified_at ?? null,
      mfaEnabled: Boolean(row.mfa_enabled), mfaSecret: row.mfa_secret ?? null,
      firstName: row.first_name ?? '', lastName: row.last_name ?? '',
    };
  }

  async getUserById(id: string) {
    const { rows } = await this.pool.query(
      `SELECT u.*, p.first_name, p.last_name FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`, [id]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }
  async getUserByPhone(phone: string) {
    const { rows } = await this.pool.query(
      `SELECT u.*, p.first_name, p.last_name FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.phone = $1`, [phone]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }
  async getUserByEmail(email: string) {
    const { rows } = await this.pool.query(
      `SELECT u.*, p.first_name, p.last_name FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id WHERE LOWER(u.email) = LOWER($1)`, [email]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }
  private async insertProfile(userId: string, firstName: string, lastName: string) {
    await this.pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name)
       VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`,
      [userId, firstName, lastName]);
  }
  async createPhoneUser(phone: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (phone) VALUES ($1) RETURNING id`, [phone]);
    await this.insertProfile(rows[0].id, '', '');
    return (await this.getUserById(rows[0].id))!;
  }
  async createAdminUser(email: string, passwordHash: string, firstName: string, lastName: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`, [email, passwordHash]);
    await this.insertProfile(rows[0].id, firstName, lastName);
    return (await this.getUserById(rows[0].id))!;
  }
  async updateUserProfile(id: string, firstName: string, lastName: string) {
    await this.insertProfile(id, firstName, lastName);
    return this.getUserById(id);
  }
  async setMfa(id: string, secret: string | null, enabled: boolean) {
    await this.pool.query(`UPDATE users SET mfa_secret = $2, mfa_enabled = $3, updated_at = now() WHERE id = $1`, [id, secret, enabled]);
    return this.getUserById(id);
  }
  async markPhoneVerified(id: string) {
    await this.pool.query(`UPDATE users SET phone_verified_at = now(), updated_at = now() WHERE id = $1`, [id]);
  }
  async createOtp(phone: string, codeHash: string, expiresAt: Date) {
    const { rows } = await this.pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING *`, [phone, codeHash, expiresAt]);
    const r = rows[0];
    return { id: r.id, phone: r.phone, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at, consumedAt: r.consumed_at };
  }
  async getLatestOtp(phone: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [phone]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, phone: r.phone, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at, consumedAt: r.consumed_at };
  }
  async incrementOtpAttempts(id: string) {
    await this.pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [id]);
  }
  async consumeOtp(id: string) {
    await this.pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [id]);
  }
  async createSession(userId: string, refreshTokenHash: string, expiresAt: Date) {
    const { rows } = await this.pool.query(
      `INSERT INTO sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3) RETURNING *`, [userId, refreshTokenHash, expiresAt]);
    const r = rows[0];
    return { id: r.id, userId: r.user_id, refreshTokenHash: r.refresh_token_hash, revokedAt: r.revoked_at, expiresAt: r.expires_at };
  }
  async getSessionByHash(hash: string) {
    const { rows } = await this.pool.query(`SELECT * FROM sessions WHERE refresh_token_hash = $1`, [hash]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, userId: r.user_id, refreshTokenHash: r.refresh_token_hash, revokedAt: r.revoked_at, expiresAt: r.expires_at };
  }
  async revokeSession(id: string) {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [id]);
  }
  async revokeAllSessions(userId: string) {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
  async listRoles() {
    const { rows } = await this.pool.query(`SELECT * FROM roles ORDER BY name`);
    const out: RoleRecord[] = [];
    for (const r of rows) {
      const perms = await this.pool.query(
        `SELECT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1`, [r.id]);
      out.push({ id: r.id, name: r.name, permissionNames: perms.rows.map((x: any) => x.name) });
    }
    return out;
  }
  async createRole(name: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING *`, [name]);
    return { id: rows[0].id, name: rows[0].name, permissionNames: [] };
  }
  async addPermissionToRole(roleId: string, permissionName: string) {
    const perm = await this.pool.query(
      `INSERT INTO permissions (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [permissionName]);
    await this.pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [roleId, perm.rows[0].id]);
    const roles = await this.listRoles();
    return roles.find((r) => r.id === roleId) ?? null;
  }
  async assignRoleToUser(userId: string, roleId: string) {
    await this.pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`, [userId, roleId]);
  }
  async getRolesForUser(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.* FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1`, [userId]);
    const out: RoleRecord[] = [];
    for (const r of rows) {
      const perms = await this.pool.query(
        `SELECT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1`, [r.id]);
      out.push({ id: r.id, name: r.name, permissionNames: perms.rows.map((x: any) => x.name) });
    }
    return out;
  }
  async getPermissionsForUser(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = $1`, [userId]);
    return rows.map((r: any) => r.name);
  }
  // ---- Driver / KYC (Phase 5; SQL against migration 004) ----
  private mapDriverProfile(row: any): DriverProfileRecord {
    return {
      userId: row.user_id, kycStatus: row.kyc_status, rejectionReason: row.kyc_rejection_reason ?? null,
      emergencyContactName: row.emergency_contact_name ?? null, emergencyContactPhone: row.emergency_contact_phone ?? null,
      bankAccount: row.bank_account ?? null,
    };
  }
  async getDriverProfile(userId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_profiles WHERE user_id = $1`, [userId]);
    return rows[0] ? this.mapDriverProfile(rows[0]) : null;
  }
  async createDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null) {
    const { rows } = await this.pool.query(
      `INSERT INTO driver_profiles (user_id, emergency_contact_name, emergency_contact_phone, bank_account)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING RETURNING *`,
      [userId, emergencyContactName, emergencyContactPhone, bankAccount]);
    if (rows[0]) return this.mapDriverProfile(rows[0]);
    return (await this.getDriverProfile(userId))!;
  }
  async updateDriverProfile(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null) {
    await this.pool.query(
      `UPDATE driver_profiles SET emergency_contact_name = $2, emergency_contact_phone = $3, bank_account = $4, updated_at = now() WHERE user_id = $1`,
      [userId, emergencyContactName, emergencyContactPhone, bankAccount]);
    return this.getDriverProfile(userId);
  }
  async setDriverKycStatus(userId: string, status: string, reason: string | null) {
    await this.pool.query(
      `UPDATE driver_profiles SET kyc_status = $2, kyc_rejection_reason = $3, updated_at = now() WHERE user_id = $1`,
      [userId, status, reason]);
    return this.getDriverProfile(userId);
  }
  async listDriverProfilesByKyc(status: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_profiles WHERE kyc_status = $1 ORDER BY created_at`, [status]);
    return rows.map((r: any) => this.mapDriverProfile(r));
  }
  async addDriverDocument(doc: Omit<DriverDocumentRecord, 'id'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO driver_documents (driver_user_id, document_type, storage_key, mime_type, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [doc.driverUserId, doc.documentType, doc.storageKey, doc.mimeType, doc.expiresAt]);
    const r = rows[0];
    return { id: r.id, driverUserId: r.driver_user_id, documentType: r.document_type, storageKey: r.storage_key, mimeType: r.mime_type, expiresAt: r.expires_at };
  }
  async getDriverDocument(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_documents WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, driverUserId: r.driver_user_id, documentType: r.document_type, storageKey: r.storage_key, mimeType: r.mime_type, expiresAt: r.expires_at };
  }
  async listDriverDocuments(userId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_documents WHERE driver_user_id = $1 ORDER BY created_at`, [userId]);
    return rows.map((r: any) => ({ id: r.id, driverUserId: r.driver_user_id, documentType: r.document_type, storageKey: r.storage_key, mimeType: r.mime_type, expiresAt: r.expires_at }));
  }
  async addDriverHistory(entry: Omit<DriverHistoryRecord, 'createdAt'>) {
    await this.pool.query(
      `INSERT INTO driver_status_history (driver_user_id, from_status, to_status, actor_id, actor_role, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.driverUserId, entry.fromStatus, entry.toStatus, entry.actorId, entry.actorRole, entry.reason]);
  }
  async listDriverHistory(userId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM driver_status_history WHERE driver_user_id = $1 ORDER BY created_at`, [userId]);
    return rows.map((r: any) => ({ driverUserId: r.driver_user_id, fromStatus: r.from_status, toStatus: r.to_status, actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, createdAt: r.created_at }));
  }
  async createVehicle(v: Omit<VehicleRecord, 'id' | 'approvalStatus' | 'isActive'>) {
    const cat = await this.pool.query(`SELECT id FROM vehicle_categories WHERE code = $1`, [v.categoryCode]);
    if (!cat.rows[0]) throw new Error(`Unknown vehicle category ${v.categoryCode}`);
    const { rows } = await this.pool.query(
      `INSERT INTO vehicles (owner_user_id, category_id, make, model, year, color, registration_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [v.ownerUserId, cat.rows[0].id, v.make, v.model, v.year, v.color, v.registrationNumber]);
    const r = rows[0];
    return { id: r.id, ownerUserId: r.owner_user_id, categoryCode: v.categoryCode, make: r.make, model: r.model, year: r.year, color: r.color, registrationNumber: r.registration_number, approvalStatus: r.approval_status, isActive: false };
  }
  async listVehiclesByOwner(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT v.*, c.code AS category_code, EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.vehicle_id = v.id AND a.is_active) AS is_active
       FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id WHERE v.owner_user_id = $1 ORDER BY v.created_at`, [userId]);
    return rows.map((r: any) => ({ id: r.id, ownerUserId: r.owner_user_id, categoryCode: r.category_code, make: r.make, model: r.model, year: r.year, color: r.color, registrationNumber: r.registration_number, approvalStatus: r.approval_status, isActive: Boolean(r.is_active) }));
  }
  async getVehicle(id: string) {
    const { rows } = await this.pool.query(
      `SELECT v.*, c.code AS category_code, EXISTS (SELECT 1 FROM driver_vehicle_assignments a WHERE a.vehicle_id = v.id AND a.is_active) AS is_active
       FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id WHERE v.id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, ownerUserId: r.owner_user_id, categoryCode: r.category_code, make: r.make, model: r.model, year: r.year, color: r.color, registrationNumber: r.registration_number, approvalStatus: r.approval_status, isActive: Boolean(r.is_active) };
  }
  async setVehicleApproval(id: string, status: string) {
    await this.pool.query(`UPDATE vehicles SET approval_status = $2, updated_at = now() WHERE id = $1`, [id, status]);
    return this.getVehicle(id);
  }
  async setActiveVehicle(userId: string, vehicleId: string) {
    const vehicle = await this.getVehicle(vehicleId);
    if (!vehicle || vehicle.ownerUserId !== userId) return null;
    await this.pool.query(`UPDATE driver_vehicle_assignments SET is_active = false WHERE driver_user_id = $1`, [userId]);
    await this.pool.query(
      `INSERT INTO driver_vehicle_assignments (driver_user_id, vehicle_id, is_active) VALUES ($1, $2, true)
       ON CONFLICT (driver_user_id, vehicle_id) DO UPDATE SET is_active = true`, [userId, vehicleId]);
    return this.getVehicle(vehicleId);
  }

  // ---- Rides / pricing (Phase 6; SQL against migrations 001 + 005) ----
  async createCity(city: Omit<CityRecord, 'id'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO cities (name, country_code, currency, timezone, centre, is_active)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7) RETURNING id`,
      [city.name, city.countryCode, city.currency, city.timezone, city.centreLng, city.centreLat, city.isActive ?? true]);
    return { ...city, isActive: city.isActive ?? true, id: rows[0].id };
  }
  async listCities() {
    const { rows } = await this.pool.query(
      `SELECT id, name, country_code, currency, timezone, is_active,
       ST_Y(centre::geometry) AS centre_lat, ST_X(centre::geometry) AS centre_lng FROM cities ORDER BY name`);
    return rows.map((r: any) => ({ id: r.id, name: r.name, countryCode: r.country_code, currency: r.currency, timezone: r.timezone, centreLat: r.centre_lat, centreLng: r.centre_lng, isActive: r.is_active }));
  }
  async setCityActive(id: string, isActive: boolean) {
    await this.pool.query(`UPDATE cities SET is_active = $2, updated_at = now() WHERE id = $1`, [id, isActive]);
    return (await this.listCities()).find((c) => c.id === id) ?? null;
  }
  async listPricingRules() {
    const { rows } = await this.pool.query(
      `SELECT pr.*, st.code AS service_code FROM pricing_rules pr JOIN service_types st ON st.id = pr.service_type_id ORDER BY pr.created_at`);
    return rows.map((r: any) => ({ id: r.id, cityId: r.city_id, serviceCode: r.service_code, mode: r.mode, baseFareMinor: r.base_fare_minor, perKmMinor: r.per_km_minor, perMinMinor: r.per_min_minor, minimumFareMinor: r.minimum_fare_minor, bookingFeeMinor: r.booking_fee_minor, demandCap: Number(r.demand_cap), version: r.version }));
  }
  async listServiceTypes() {
    const { rows } = await this.pool.query(`SELECT code, name, is_active FROM service_types ORDER BY code`);
    return mergeCatalog(DEFAULT_SERVICES, rows.map((r: any) => ({ code: r.code, name: r.name, isActive: r.is_active })));
  }
  async upsertServiceType(record: CatalogRecord) {
    await this.pool.query(
      `INSERT INTO service_types (code, name, is_active) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active`,
      [record.code, record.name, record.isActive]);
    return record;
  }
  async listVehicleCategories() {
    const { rows } = await this.pool.query(`SELECT code, name, is_active FROM vehicle_categories ORDER BY code`);
    return mergeCatalog(DEFAULT_VEHICLE_CATEGORIES, rows.map((r: any) => ({ code: r.code, name: r.name, isActive: r.is_active })));
  }
  async upsertVehicleCategory(record: CatalogRecord) {
    await this.pool.query(
      `INSERT INTO vehicle_categories (code, name, is_active) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active`,
      [record.code, record.name, record.isActive]);
    return record;
  }
  async addAuditLog(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, before_summary, after_summary, reason) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING *`,
      [entry.actorId, entry.action, entry.targetType, entry.targetId,
       entry.beforeSummary ? JSON.stringify(entry.beforeSummary) : null,
       entry.afterSummary ? JSON.stringify(entry.afterSummary) : null, entry.reason]);
    const r = rows[0];
    return { id: r.id, actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, beforeSummary: r.before_summary ? JSON.stringify(r.before_summary) : null, afterSummary: r.after_summary ? JSON.stringify(r.after_summary) : null, reason: r.reason, createdAt: r.created_at };
  }
  async listAuditLogs(limit: number) {
    const { rows } = await this.pool.query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.map((r: any) => ({ id: r.id, actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, beforeSummary: r.before_summary ? JSON.stringify(r.before_summary) : null, afterSummary: r.after_summary ? JSON.stringify(r.after_summary) : null, reason: r.reason, createdAt: r.created_at }));
  }
  async getAdminOverview(): Promise<AdminOverview> {
    const count = async (sql: string, col: string) => {
      const { rows } = await this.pool.query(sql);
      const out: Record<string, number> = {};
      for (const r of rows) out[r[col]] = Number(r.count);
      return out;
    };
    const cities = await this.listCities();
    return {
      usersTotal: Number((await this.pool.query(`SELECT COUNT(*) AS count FROM users`)).rows[0].count),
      driversByKyc: await count(`SELECT kyc_status AS kyc_status, COUNT(*) AS count FROM driver_profiles GROUP BY kyc_status`, 'kyc_status'),
      ridesByStatus: await count(`SELECT status, COUNT(*) AS count FROM rides GROUP BY status`, 'status'),
      paymentsByStatus: await count(`SELECT status, COUNT(*) AS count FROM payments GROUP BY status`, 'status'),
      commissionBalanceMinor: await this.getBalance('COMMISSION', null),
      pendingTopups: Number((await this.pool.query(`SELECT COUNT(*) AS count FROM wallet_topups WHERE status = 'PENDING'`)).rows[0].count),
      pendingWithdrawals: Number((await this.pool.query(`SELECT COUNT(*) AS count FROM withdrawal_requests WHERE status = 'PENDING'`)).rows[0].count),
      citiesTotal: cities.length,
      activeCities: cities.filter((c) => c.isActive).length,
    };
  }
  async createPricingRule(rule: Omit<PricingRuleRecord, 'id'>) {
    const service = await this.pool.query(`SELECT id FROM service_types WHERE code = $1`, [rule.serviceCode]);
    if (!service.rows[0]) throw new Error(`Unknown service type ${rule.serviceCode}`);
    const { rows } = await this.pool.query(
      `INSERT INTO pricing_rules (city_id, service_type_id, mode, base_fare_minor, per_km_minor, per_min_minor, minimum_fare_minor, booking_fee_minor, demand_cap, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [rule.cityId, service.rows[0].id, rule.mode, rule.baseFareMinor, rule.perKmMinor, rule.perMinMinor, rule.minimumFareMinor, rule.bookingFeeMinor, rule.demandCap, rule.version]);
    return { ...rule, id: rows[0].id };
  }
  async getPricingRule(cityId: string | null, serviceCode: string) {
    const { rows } = await this.pool.query(
      `SELECT pr.*, st.code AS service_code FROM pricing_rules pr
       JOIN service_types st ON st.id = pr.service_type_id
       WHERE st.code = $2 AND (pr.city_id = $1 OR pr.city_id IS NULL)
       ORDER BY (pr.city_id IS NOT NULL) DESC, pr.effective_from DESC LIMIT 1`,
      [cityId, serviceCode]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, cityId: r.city_id, serviceCode: r.service_code, mode: r.mode, baseFareMinor: r.base_fare_minor, perKmMinor: r.per_km_minor, perMinMinor: r.per_min_minor, minimumFareMinor: r.minimum_fare_minor, bookingFeeMinor: r.booking_fee_minor, demandCap: Number(r.demand_cap), version: r.version };
  }
  private mapRideRequest(r: any): RideRequestRecord {
    return {
      id: r.id, customerId: r.customer_id, cityId: r.city_id, serviceCode: r.service_code, categoryCode: r.category_code,
      pickupLat: Number(r.pickup_lat), pickupLng: Number(r.pickup_lng), destinationLat: Number(r.destination_lat), destinationLng: Number(r.destination_lng),
      pickupLabel: r.pickup_label, destinationLabel: r.destination_label, suggestedFareMinor: r.suggested_fare_minor, minimumFareMinor: r.minimum_fare_minor, bookingFeeMinor: r.booking_fee_minor,
      customerOfferMinor: r.customer_offer_minor, pricingMode: r.pricing_mode, pricingRuleVersion: r.pricing_rule_version,
      status: r.status, paymentMethod: r.payment_method, distanceKm: Number(r.distance_km), durationMin: r.duration_min,
      expiresAt: r.expires_at, createdAt: r.created_at,
    };
  }
  async createRideRequest(r: Omit<RideRequestRecord, 'id' | 'createdAt'>) {
    const service = await this.pool.query(`SELECT id FROM service_types WHERE code = $1`, [r.serviceCode]);
    const category = r.categoryCode ? await this.pool.query(`SELECT id FROM vehicle_categories WHERE code = $1`, [r.categoryCode]) : null;
    const { rows } = await this.pool.query(
      `INSERT INTO ride_requests (customer_id, city_id, service_type_id, category_id, category_code, pickup_geo, destination_geo, pickup_label, destination_label, suggested_fare_minor, customer_offer_minor, minimum_fare_minor, booking_fee_minor, pricing_mode, pricing_rule_version, status, payment_method, distance_km, duration_min, expires_at)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [r.customerId, r.cityId, service.rows[0]?.id ?? null, category?.rows[0]?.id ?? null, r.categoryCode, r.pickupLng, r.pickupLat, r.destinationLng, r.destinationLat, r.pickupLabel, r.destinationLabel, r.suggestedFareMinor, r.customerOfferMinor, r.minimumFareMinor, r.bookingFeeMinor, r.pricingMode, r.pricingRuleVersion, r.status, r.paymentMethod, r.distanceKm, r.durationMin, r.expiresAt]);
    // The RETURNING row lacks service_code; fetch the full row via a join-free second query is avoided by mapping manually:
    const row = rows[0];
    return {
      id: row.id, customerId: row.customer_id, cityId: row.city_id, serviceCode: r.serviceCode, categoryCode: r.categoryCode,
      pickupLat: r.pickupLat, pickupLng: r.pickupLng, destinationLat: r.destinationLat, destinationLng: r.destinationLng,
      pickupLabel: row.pickup_label, destinationLabel: row.destination_label, suggestedFareMinor: row.suggested_fare_minor,
      customerOfferMinor: row.customer_offer_minor, minimumFareMinor: row.minimum_fare_minor, bookingFeeMinor: row.booking_fee_minor, pricingMode: row.pricing_mode, pricingRuleVersion: row.pricing_rule_version,
      status: row.status, paymentMethod: row.payment_method, distanceKm: Number(row.distance_km), durationMin: row.duration_min,
      expiresAt: row.expires_at, createdAt: row.created_at,
    };
  }
  async getRideRequest(id: string) {
    const { rows } = await this.pool.query(
      `SELECT rr.*, st.code AS service_code, ST_Y(rr.pickup_geo::geometry) AS pickup_lat, ST_X(rr.pickup_geo::geometry) AS pickup_lng,
       ST_Y(rr.destination_geo::geometry) AS destination_lat, ST_X(rr.destination_geo::geometry) AS destination_lng
       FROM ride_requests rr LEFT JOIN service_types st ON st.id = rr.service_type_id WHERE rr.id = $1`, [id]);
    return rows[0] ? this.mapRideRequest(rows[0]) : null;
  }
  async listRideRequestsByCustomer(customerId: string) {
    const { rows } = await this.pool.query(
      `SELECT rr.*, st.code AS service_code, ST_Y(rr.pickup_geo::geometry) AS pickup_lat, ST_X(rr.pickup_geo::geometry) AS pickup_lng,
       ST_Y(rr.destination_geo::geometry) AS destination_lat, ST_X(rr.destination_geo::geometry) AS destination_lng
       FROM ride_requests rr LEFT JOIN service_types st ON st.id = rr.service_type_id WHERE rr.customer_id = $1 ORDER BY rr.created_at DESC`, [customerId]);
    return rows.map((r: any) => this.mapRideRequest(r));
  }
  async setRideRequestStatus(id: string, status: string) {
    await this.pool.query(`UPDATE ride_requests SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
    return this.getRideRequest(id);
  }
  async addRequestHistory(entry: Omit<RequestHistoryRecord, 'createdAt'>) {
    await this.pool.query(
      `INSERT INTO request_status_history (request_id, from_status, to_status, actor_id, actor_role, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.requestId, entry.fromStatus, entry.toStatus, entry.actorId, entry.actorRole, entry.reason]);
  }
  async listRequestHistory(requestId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM request_status_history WHERE request_id = $1 ORDER BY created_at`, [requestId]);
    return rows.map((r: any) => ({ requestId: r.request_id, fromStatus: r.from_status, toStatus: r.to_status, actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, createdAt: r.created_at }));
  }

  // ---- Dispatch stats / attempts (Phase 7; SQL against migration 006) ----
  async getDriverStats(driverUserId: string) {
    const stats = await this.pool.query(`SELECT * FROM driver_stats WHERE driver_user_id = $1`, [driverUserId]);
    const profile = await this.pool.query(`SELECT rating_sum, rating_count FROM driver_profiles WHERE user_id = $1`, [driverUserId]);
    const s = stats.rows[0];
    return {
      driverUserId,
      tripsToday: s ? Number(s.trips_today) : 0,
      offersSent: s ? Number(s.offers_sent) : 0,
      offersAccepted: s ? Number(s.offers_accepted) : 0,
      ratingSum: profile.rows[0] ? Number(profile.rows[0].rating_sum) : 0,
      ratingCount: profile.rows[0] ? Number(profile.rows[0].rating_count) : 0,
    };
  }
  async setDriverStats(stats: DriverStatsRecord) {
    await this.pool.query(
      `INSERT INTO driver_stats (driver_user_id, trips_today, offers_sent, offers_accepted) VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_user_id) DO UPDATE SET trips_today = EXCLUDED.trips_today, offers_sent = EXCLUDED.offers_sent, offers_accepted = EXCLUDED.offers_accepted, updated_at = now()`,
      [stats.driverUserId, stats.tripsToday, stats.offersSent, stats.offersAccepted]);
    if (stats.ratingCount > 0 || stats.ratingSum > 0) {
      await this.pool.query(`UPDATE driver_profiles SET rating_sum = $2, rating_count = $3 WHERE user_id = $1`, [stats.driverUserId, stats.ratingSum, stats.ratingCount]);
    }
  }
  async incrementOfferSent(driverUserId: string) {
    await this.pool.query(
      `INSERT INTO driver_stats (driver_user_id, offers_sent) VALUES ($1, 1)
       ON CONFLICT (driver_user_id) DO UPDATE SET offers_sent = driver_stats.offers_sent + 1, updated_at = now()`, [driverUserId]);
  }
  async addDispatchAttempt(attempt: DispatchAttemptRecord) {
    await this.pool.query(
      `INSERT INTO dispatch_attempts (request_id, driver_user_id, radius_km, score, distance_km, outcome)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [attempt.requestId, attempt.driverUserId, attempt.radiusKm, attempt.score, attempt.distanceKm, attempt.outcome]);
  }
  async listDispatchAttempts(requestId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM dispatch_attempts WHERE request_id = $1 ORDER BY created_at`, [requestId]);
    return rows.map((r: any) => ({ requestId: r.request_id, driverUserId: r.driver_user_id, radiusKm: Number(r.radius_km), score: Number(r.score), distanceKm: Number(r.distance_km), outcome: r.outcome, createdAt: r.created_at }));
  }
  async getDeclinedDriverIds(requestId: string) {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT driver_user_id FROM dispatch_attempts WHERE request_id = $1 AND outcome IN ('DECLINED', 'TIMEOUT')`, [requestId]);
    return rows.map((r: any) => r.driver_user_id);
  }

  // ---- Offers / rides (Phase 8; SQL against migrations 002 + 007) ----
  private mapOffer(r: any): OfferRecord {
    return { id: r.id, requestId: r.request_id, driverId: r.driver_id, proposedFareMinor: r.proposed_fare_minor, status: r.status, expiresAt: r.expires_at, counterCount: r.counter_count ?? 0, createdAt: r.created_at };
  }
  async createOffer(offer: Omit<OfferRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO ride_offers (request_id, driver_id, proposed_fare_minor, status, expires_at, counter_count) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [offer.requestId, offer.driverId, offer.proposedFareMinor, offer.status, offer.expiresAt, offer.counterCount]);
    return this.mapOffer(rows[0]);
  }
  async getOffer(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ride_offers WHERE id = $1`, [id]);
    return rows[0] ? this.mapOffer(rows[0]) : null;
  }
  async listOffersByRequest(requestId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ride_offers WHERE request_id = $1 ORDER BY created_at`, [requestId]);
    return rows.map((r: any) => this.mapOffer(r));
  }
  async setOfferStatus(id: string, status: string) {
    await this.pool.query(`UPDATE ride_offers SET status = $2 WHERE id = $1`, [id, status]);
    return this.getOffer(id);
  }
  async updateOfferFare(id: string, fareMinor: number, counterCount: number) {
    await this.pool.query(`UPDATE ride_offers SET proposed_fare_minor = $2, counter_count = $3 WHERE id = $1`, [id, fareMinor, counterCount]);
    return this.getOffer(id);
  }
  async createRide(ride: Omit<RideRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO rides (request_id, customer_id, driver_id, vehicle_id, status, final_fare_minor, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [ride.requestId, ride.customerId, ride.driverId, ride.vehicleId, ride.status, ride.finalFareMinor, ride.paymentMethod]);
    const r = rows[0];
    return { id: r.id, requestId: r.request_id, customerId: r.customer_id, driverId: r.driver_id, vehicleId: r.vehicle_id, status: r.status, finalFareMinor: r.final_fare_minor, commissionMinor: r.commission_minor, commissionRuleVersion: r.commission_rule_version, paymentMethod: r.payment_method, createdAt: r.created_at };
  }
  async getRideByRequestId(requestId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM rides WHERE request_id = $1`, [requestId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, requestId: r.request_id, customerId: r.customer_id, driverId: r.driver_id, vehicleId: r.vehicle_id, status: r.status, finalFareMinor: r.final_fare_minor, commissionMinor: r.commission_minor, commissionRuleVersion: r.commission_rule_version, paymentMethod: r.payment_method, createdAt: r.created_at };
  }
  async getRideById(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM rides WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, requestId: r.request_id, customerId: r.customer_id, driverId: r.driver_id, vehicleId: r.vehicle_id, status: r.status, finalFareMinor: r.final_fare_minor, commissionMinor: r.commission_minor, commissionRuleVersion: r.commission_rule_version, paymentMethod: r.payment_method, createdAt: r.created_at };
  }
  async setDispatchAttemptOutcome(requestId: string, driverId: string, outcome: string) {
    await this.pool.query(
      `UPDATE dispatch_attempts SET outcome = $3 WHERE request_id = $1 AND driver_user_id = $2 AND outcome = 'OFFERED'`, [requestId, driverId, outcome]);
  }
  /**
   * Phase 16 single-transaction accept. The request row is locked
   * first, so two concurrent accepts on different API instances
   * serialise here instead of racing through the service lock.
   * Every accept write happens inside this transaction; any error
   * rolls everything back. Error codes (not HTTP statuses):
   * REQUEST_NOT_FOUND, REQUEST_NOT_OFFERING, OFFER_NOT_LIVE.
   */
  async acceptOfferAtomic(input: AcceptOfferTxInput): Promise<AcceptOfferTxResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reqRes = await client.query(`SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`, [input.requestId]);
      if (!reqRes.rows[0]) throw new Error('REQUEST_NOT_FOUND');
      if (reqRes.rows[0].status !== 'OFFERING') throw new Error('REQUEST_NOT_OFFERING');
      const offRes = await client.query(`SELECT * FROM ride_offers WHERE id = $1 FOR UPDATE`, [input.offerId]);
      if (!offRes.rows[0] || offRes.rows[0].status !== 'LIVE' || offRes.rows[0].driver_id !== input.driverId) {
        throw new Error('OFFER_NOT_LIVE');
      }
      const rideRes = await client.query(
        `INSERT INTO rides (request_id, customer_id, driver_id, vehicle_id, status, final_fare_minor, payment_method)
         VALUES ($1, $2, $3, $4, 'DRIVER_SELECTED', $5, $6) RETURNING *`,
        [input.requestId, input.customerId, input.driverId, input.vehicleId, input.finalFareMinor, input.paymentMethod]);
      const rideRow = rideRes.rows[0];
      await client.query(`UPDATE ride_requests SET status = 'DRIVER_SELECTED', updated_at = now() WHERE id = $1`, [input.requestId]);
      await client.query(
        `INSERT INTO request_status_history (request_id, from_status, to_status, actor_id, actor_role, reason)
         VALUES ($1, 'OFFERING', 'DRIVER_SELECTED', $2, 'CUSTOMER', NULL)`,
        [input.requestId, input.customerId]);
      await client.query(`UPDATE ride_offers SET status = 'ACCEPTED' WHERE id = $1`, [input.offerId]);
      await client.query(`UPDATE ride_offers SET status = 'SUPERSEDED' WHERE request_id = $1 AND status = 'LIVE' AND id <> $2`, [input.requestId, input.offerId]);
      await client.query(`UPDATE dispatch_attempts SET outcome = 'ACCEPTED' WHERE request_id = $1 AND driver_user_id = $2 AND outcome = 'OFFERED'`, [input.requestId, input.driverId]);
      await client.query(`UPDATE dispatch_attempts SET outcome = 'SUPERSEDED' WHERE request_id = $1 AND driver_user_id <> $2 AND outcome = 'OFFERED'`, [input.requestId, input.driverId]);
      await client.query(
        `INSERT INTO driver_stats (driver_user_id, offers_accepted) VALUES ($1, 1)
         ON CONFLICT (driver_user_id) DO UPDATE SET offers_accepted = driver_stats.offers_accepted + 1, updated_at = now()`, [input.driverId]);
      await client.query(`INSERT INTO ride_pins (ride_id, pin_hash, attempts, verified_at) VALUES ($1, $2, 0, NULL)`, [rideRow.id, input.pinHash]);
      if (input.deliveryDetails) {
        const d = input.deliveryDetails;
        await client.query(
          `INSERT INTO delivery_details (ride_id, sender_name, sender_phone, recipient_name, recipient_phone, package_category, size_weight, notes, photo_storage_key, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'COURIER_SELECTED')`,
          [rideRow.id, d.senderName, d.senderPhone, d.recipientName, d.recipientPhone, d.packageCategory, d.sizeWeight, d.notes]);
        await client.query(
          `INSERT INTO delivery_status_history (ride_id, from_status, to_status, actor_id, actor_role, reason)
           VALUES ($1, NULL, 'COURIER_SELECTED', $2, 'CUSTOMER', NULL)`,
          [rideRow.id, input.customerId]);
        if (input.deliveryOtpHash) {
          await client.query(
            `INSERT INTO delivery_proofs (ride_id, proof_type, storage_key, otp_hash, verified_by, attempts)
             VALUES ($1, 'OTP', NULL, $2, NULL, 0)`,
            [rideRow.id, input.deliveryOtpHash]);
        }
      }
      await client.query('COMMIT');
      const ride = { id: rideRow.id, requestId: rideRow.request_id, customerId: rideRow.customer_id, driverId: rideRow.driver_id, vehicleId: rideRow.vehicle_id, status: rideRow.status, finalFareMinor: rideRow.final_fare_minor, commissionMinor: rideRow.commission_minor, commissionRuleVersion: rideRow.commission_rule_version, paymentMethod: rideRow.payment_method, createdAt: rideRow.created_at };
      const offer = await this.getOffer(input.offerId);
      const request = await this.getRideRequest(input.requestId);
      if (!offer || !request) throw new Error('REQUEST_NOT_FOUND');
      return { ride, offer, request };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async incrementOffersAccepted(driverId: string) {
    await this.pool.query(
      `INSERT INTO driver_stats (driver_user_id, offers_accepted) VALUES ($1, 1)
       ON CONFLICT (driver_user_id) DO UPDATE SET offers_accepted = driver_stats.offers_accepted + 1, updated_at = now()`, [driverId]);
  }
  async listOpenRequestsForDriver(driverId: string) {
    const { rows } = await this.pool.query(
      `SELECT rr.*, st.code AS service_code, ST_Y(rr.pickup_geo::geometry) AS pickup_lat, ST_X(rr.pickup_geo::geometry) AS pickup_lng,
       ST_Y(rr.destination_geo::geometry) AS destination_lat, ST_X(rr.destination_geo::geometry) AS destination_lng
       FROM ride_requests rr
       JOIN dispatch_attempts da ON da.request_id = rr.id AND da.driver_user_id = $1 AND da.outcome = 'OFFERED'
       LEFT JOIN service_types st ON st.id = rr.service_type_id
       WHERE rr.status = 'OFFERING' ORDER BY rr.created_at DESC`, [driverId]);
    return rows.map((r: any) => this.mapRideRequest(r));
  }

  // ---- Live tracking (Phase 9; SQL against migration 002 ride_locations) ----
  async addRideLocation(location: Omit<RideLocationRecord, 'recordedAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO ride_locations (ride_id, point) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING recorded_at`,
      [location.rideId, location.lng, location.lat]);
    return { ...location, recordedAt: rows[0].recorded_at };
  }
  async getLatestRideLocation(rideId: string) {
    const { rows } = await this.pool.query(
      `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, recorded_at FROM ride_locations WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [rideId]);
    return rows[0] ? { rideId, lat: Number(rows[0].lat), lng: Number(rows[0].lng), recordedAt: rows[0].recorded_at } : null;
  }
  async listRideLocations(rideId: string, limit: number) {
    const { rows } = await this.pool.query(
      `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, recorded_at FROM ride_locations WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT $2`, [rideId, limit]);
    return rows.reverse().map((r: any) => ({ rideId, lat: Number(r.lat), lng: Number(r.lng), recordedAt: r.recorded_at }));
  }

  // ---- Trip lifecycle (Phase 10; SQL against migration 002 ride_status_history + ride_pins) ----
  async setRideStatus(rideId: string, status: string) {
    await this.pool.query(`UPDATE rides SET status = $2, updated_at = now() WHERE id = $1`, [rideId, status]);
    return this.getRideById(rideId);
  }
  async addRideHistory(entry: Omit<RideHistoryRecord, 'createdAt'>) {
    await this.pool.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor_id, actor_role, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.rideId, entry.fromStatus, entry.toStatus, entry.actorId, entry.actorRole, entry.reason]);
  }
  async listRideHistory(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ride_status_history WHERE ride_id = $1 ORDER BY created_at`, [rideId]);
    return rows.map((r: any) => ({ rideId: r.ride_id, fromStatus: r.from_status, toStatus: r.to_status, actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, createdAt: r.created_at }));
  }
  async createRidePin(pin: RidePinRecord) {
    await this.pool.query(
      `INSERT INTO ride_pins (ride_id, pin_hash, attempts, verified_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (ride_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, attempts = EXCLUDED.attempts, verified_at = EXCLUDED.verified_at`,
      [pin.rideId, pin.pinHash, pin.attempts, pin.verifiedAt]);
  }
  async getRidePin(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ride_pins WHERE ride_id = $1`, [rideId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { rideId: r.ride_id, pinHash: r.pin_hash, attempts: r.attempts, verifiedAt: r.verified_at };
  }
  async incrementPinAttempts(rideId: string) {
    await this.pool.query(`UPDATE ride_pins SET attempts = attempts + 1 WHERE ride_id = $1`, [rideId]);
    return this.getRidePin(rideId);
  }
  async setPinVerified(rideId: string) {
    await this.pool.query(`UPDATE ride_pins SET verified_at = now() WHERE ride_id = $1`, [rideId]);
  }

  // ---- Delivery (Phase 11; SQL against migrations 002 + 008) ----
  private mapDeliveryDetails(r: any, requestId: string): DeliveryDetails {
    return {
      rideId: r.ride_id, requestId, senderName: r.sender_name, senderPhone: r.sender_phone,
      recipientName: r.recipient_name, recipientPhone: r.recipient_phone,
      packageCategory: r.package_category, sizeWeight: r.size_weight, notes: r.notes,
      status: r.status, photoStorageKey: r.photo_storage_key,
    };
  }
  async createDeliveryRequestDetails(details: DeliveryRequestDetails) {
    await this.pool.query(
      `INSERT INTO delivery_request_details (request_id, sender_name, sender_phone, recipient_name, recipient_phone, package_category, size_weight, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [details.requestId, details.senderName, details.senderPhone, details.recipientName, details.recipientPhone, details.packageCategory, details.sizeWeight, details.notes]);
  }
  async getDeliveryRequestDetails(requestId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM delivery_request_details WHERE request_id = $1`, [requestId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { requestId: r.request_id, senderName: r.sender_name, senderPhone: r.sender_phone, recipientName: r.recipient_name, recipientPhone: r.recipient_phone, packageCategory: r.package_category, sizeWeight: r.size_weight, notes: r.notes };
  }
  async createDeliveryDetails(details: DeliveryDetails) {
    await this.pool.query(
      `INSERT INTO delivery_details (ride_id, sender_name, sender_phone, recipient_name, recipient_phone, package_category, size_weight, notes, photo_storage_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [details.rideId, details.senderName, details.senderPhone, details.recipientName, details.recipientPhone, details.packageCategory, details.sizeWeight, details.notes, details.photoStorageKey, details.status]);
  }
  async getDeliveryDetails(rideId: string) {
    const ride = await this.getRideById(rideId);
    const { rows } = await this.pool.query(`SELECT * FROM delivery_details WHERE ride_id = $1`, [rideId]);
    if (!rows[0]) return null;
    return this.mapDeliveryDetails(rows[0], ride?.requestId ?? '');
  }
  async setDeliveryStatus(rideId: string, status: string) {
    await this.pool.query(`UPDATE delivery_details SET status = $2 WHERE ride_id = $1`, [rideId, status]);
    return this.getDeliveryDetails(rideId);
  }
  async addDeliveryHistory(entry: Omit<DeliveryHistoryRecord, 'createdAt'>) {
    await this.pool.query(
      `INSERT INTO delivery_status_history (ride_id, from_status, to_status, actor_id, actor_role, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.rideId, entry.fromStatus, entry.toStatus, entry.actorId, entry.actorRole, entry.reason]);
  }
  async listDeliveryHistory(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM delivery_status_history WHERE ride_id = $1 ORDER BY created_at`, [rideId]);
    return rows.map((r: any) => ({ rideId: r.ride_id, fromStatus: r.from_status, toStatus: r.to_status, actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, createdAt: r.created_at }));
  }
  private mapDeliveryProof(r: any): DeliveryProofRecord {
    return { id: r.id, rideId: r.ride_id, proofType: r.proof_type, storageKey: r.storage_key, otpHash: r.otp_hash, verifiedBy: r.verified_by, attempts: r.attempts ?? 0, createdAt: r.created_at };
  }
  async createDeliveryProof(proof: Omit<DeliveryProofRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO delivery_proofs (ride_id, proof_type, storage_key, otp_hash, verified_by, attempts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [proof.rideId, proof.proofType, proof.storageKey, proof.otpHash, proof.verifiedBy, proof.attempts]);
    return this.mapDeliveryProof(rows[0]);
  }
  async listDeliveryProofs(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM delivery_proofs WHERE ride_id = $1 ORDER BY created_at`, [rideId]);
    return rows.map((r: any) => this.mapDeliveryProof(r));
  }
  async getDeliveryProofById(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM delivery_proofs WHERE id = $1`, [id]);
    return rows[0] ? this.mapDeliveryProof(rows[0]) : null;
  }
  async getDeliveryOtpProof(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM delivery_proofs WHERE ride_id = $1 AND proof_type = 'OTP' ORDER BY created_at DESC LIMIT 1`, [rideId]);
    return rows[0] ? this.mapDeliveryProof(rows[0]) : null;
  }
  async incrementDeliveryProofAttempts(id: string) {
    await this.pool.query(`UPDATE delivery_proofs SET attempts = attempts + 1 WHERE id = $1`, [id]);
    return this.getDeliveryProofById(id);
  }
  async setDeliveryProofVerified(id: string, verifiedBy: string) {
    await this.pool.query(`UPDATE delivery_proofs SET verified_by = $2 WHERE id = $1`, [id, verifiedBy]);
  }

  // ---- Payments / wallet / commission (Phase 12) ----
  async getOrCreateAccount(ownerType: string, ownerId: string | null, currency: string) {
    await this.pool.query(
      `INSERT INTO wallet_accounts (owner_type, owner_id, currency) VALUES ($1, $2, $3) ON CONFLICT (owner_type, owner_id, currency) DO NOTHING`,
      [ownerType, ownerId, currency]);
    const { rows } = await this.pool.query(
      `SELECT * FROM wallet_accounts WHERE owner_type = $1 AND owner_id IS NOT DISTINCT FROM $2 AND currency = $3`,
      [ownerType, ownerId, currency]);
    const r = rows[0];
    return { id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, currency: r.currency };
  }
  async getBalance(ownerType: string, ownerId: string | null) {
    const account = await this.getOrCreateAccount(ownerType, ownerId, 'PKR');
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount_minor), 0) AS balance FROM ledger_entries WHERE account_id = $1`, [account.id]);
    return Number(rows[0].balance);
  }
  async createLedgerEntry(entry: Omit<LedgerEntryRecord, 'id' | 'createdAt'>) {
    if (entry.idempotencyKey) {
      const existing = await this.pool.query(`SELECT * FROM ledger_entries WHERE idempotency_key = $1`, [entry.idempotencyKey]);
      if (existing.rows[0]) {
        const r = existing.rows[0];
        return { id: r.id, accountId: r.account_id, entryType: r.entry_type, amountMinor: r.amount_minor, referenceType: r.reference_type, referenceId: r.reference_id, actorId: r.actor_id, reason: r.reason, idempotencyKey: r.idempotency_key, createdAt: r.created_at };
      }
    }
    const { rows } = await this.pool.query(
      `INSERT INTO ledger_entries (account_id, entry_type, amount_minor, reference_type, reference_id, actor_id, reason, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [entry.accountId, entry.entryType, entry.amountMinor, entry.referenceType, entry.referenceId, entry.actorId, entry.reason, entry.idempotencyKey]);
    const r = rows[0];
    return { id: r.id, accountId: r.account_id, entryType: r.entry_type, amountMinor: r.amount_minor, referenceType: r.reference_type, referenceId: r.reference_id, actorId: r.actor_id, reason: r.reason, idempotencyKey: r.idempotency_key, createdAt: r.created_at };
  }
  async listLedgerEntries(ownerType: string, ownerId: string | null, limit: number) {
    const account = await this.getOrCreateAccount(ownerType, ownerId, 'PKR');
    const { rows } = await this.pool.query(
      `SELECT * FROM ledger_entries WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`, [account.id, limit]);
    return rows.map((r: any) => ({ id: r.id, accountId: r.account_id, entryType: r.entry_type, amountMinor: r.amount_minor, referenceType: r.reference_type, referenceId: r.reference_id, actorId: r.actor_id, reason: r.reason, idempotencyKey: r.idempotency_key, createdAt: r.created_at }));
  }
  private mapPayment(r: any): PaymentRecord {
    return { id: r.id, rideId: r.ride_id, provider: r.provider, providerReference: r.provider_reference, amountMinor: r.amount_minor, currency: r.currency, status: r.status, idempotencyKey: r.idempotency_key, createdAt: r.created_at };
  }
  async createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>) {
    if (payment.idempotencyKey) {
      const existing = await this.pool.query(`SELECT * FROM payments WHERE idempotency_key = $1`, [payment.idempotencyKey]);
      if (existing.rows[0]) return this.mapPayment(existing.rows[0]);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO payments (ride_id, provider, provider_reference, amount_minor, currency, status, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [payment.rideId, payment.provider, payment.providerReference, payment.amountMinor, payment.currency, payment.status, payment.idempotencyKey]);
    return this.mapPayment(rows[0]);
  }
  async getPaymentByRideId(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1`, [rideId]);
    return rows[0] ? this.mapPayment(rows[0]) : null;
  }
  async getPaymentById(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE id = $1`, [id]);
    return rows[0] ? this.mapPayment(rows[0]) : null;
  }
  async setPaymentStatus(id: string, status: string) {
    await this.pool.query(`UPDATE payments SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
    return this.getPaymentById(id);
  }
  async setRideCommission(rideId: string, commissionMinor: number, ruleVersion: number) {
    await this.pool.query(`UPDATE rides SET commission_minor = $2, commission_rule_version = $3 WHERE id = $1`, [rideId, commissionMinor, ruleVersion]);
  }
  async createCommissionRule(rule: Omit<CommissionRuleRecord, 'id'>) {
    const service = rule.serviceCode ? await this.pool.query(`SELECT id FROM service_types WHERE code = $1`, [rule.serviceCode]) : null;
    const { rows } = await this.pool.query(
      `INSERT INTO commission_rules (scope, city_id, service_type_id, driver_user_id, rate_percent, version) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [rule.scope, rule.cityId, service?.rows[0]?.id ?? null, rule.driverUserId, rule.ratePercent, rule.version]);
    return { ...rule, id: rows[0].id };
  }
  async listCommissionRules() {
    const { rows } = await this.pool.query(
      `SELECT cr.*, st.code AS service_code FROM commission_rules cr LEFT JOIN service_types st ON st.id = cr.service_type_id ORDER BY cr.created_at`);
    return rows.map((r: any) => ({ id: r.id, scope: r.scope, cityId: r.city_id, serviceCode: r.service_code, driverUserId: r.driver_user_id, ratePercent: Number(r.rate_percent), version: r.version }));
  }
  async resolveCommissionRule(driverUserId: string, cityId: string | null, serviceCode: string) {
    const rules = await this.listCommissionRules();
    const byDriver = rules.filter((r) => r.scope === 'DRIVER' && r.driverUserId === driverUserId);
    if (byDriver.length > 0) return byDriver[byDriver.length - 1];
    const byServiceCity = rules.filter((r) => r.scope === 'SERVICE_CITY' && r.cityId === cityId && r.serviceCode === serviceCode);
    if (byServiceCity.length > 0) return byServiceCity[byServiceCity.length - 1];
    const byCity = rules.filter((r) => r.scope === 'CITY' && r.cityId === cityId);
    if (byCity.length > 0) return byCity[byCity.length - 1];
    const global = rules.filter((r) => r.scope === 'GLOBAL');
    return global.length > 0 ? global[global.length - 1] : null;
  }
  async createTopup(topup: Omit<TopupRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO wallet_topups (user_id, owner_type, amount_minor, currency, status, reference) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [topup.userId, topup.ownerType, topup.amountMinor, topup.currency, topup.status, topup.reference]);
    const r = rows[0];
    return { id: r.id, userId: r.user_id, ownerType: r.owner_type, amountMinor: r.amount_minor, currency: r.currency, status: r.status, reference: r.reference, reviewedBy: r.reviewed_by, createdAt: r.created_at };
  }
  async getTopup(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM wallet_topups WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, userId: r.user_id, ownerType: r.owner_type, amountMinor: r.amount_minor, currency: r.currency, status: r.status, reference: r.reference, reviewedBy: r.reviewed_by, createdAt: r.created_at };
  }
  async listTopups(userId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM wallet_topups WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return rows.map((r: any) => ({ id: r.id, userId: r.user_id, ownerType: r.owner_type, amountMinor: r.amount_minor, currency: r.currency, status: r.status, reference: r.reference, reviewedBy: r.reviewed_by, createdAt: r.created_at }));
  }
  async setTopupStatus(id: string, status: string, reviewedBy: string) {
    await this.pool.query(`UPDATE wallet_topups SET status = $2, reviewed_by = $3, updated_at = now() WHERE id = $1`, [id, status, reviewedBy]);
    return this.getTopup(id);
  }
  async createWithdrawal(w: Omit<WithdrawalRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO withdrawal_requests (user_id, amount_minor, currency, status, payout_reference) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [w.userId, w.amountMinor, w.currency, w.status, w.payoutReference]);
    const r = rows[0];
    return { id: r.id, userId: r.user_id, amountMinor: r.amount_minor, currency: r.currency, status: r.status, payoutReference: r.payout_reference, reviewedBy: r.reviewed_by, createdAt: r.created_at };
  }
  async getWithdrawal(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM withdrawal_requests WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, userId: r.user_id, amountMinor: r.amount_minor, currency: r.currency, status: r.status, payoutReference: r.payout_reference, reviewedBy: r.reviewed_by, createdAt: r.created_at };
  }
  async listWithdrawals(userId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return rows.map((r: any) => ({ id: r.id, userId: r.user_id, amountMinor: r.amount_minor, currency: r.currency, status: r.status, payoutReference: r.payout_reference, reviewedBy: r.reviewed_by, createdAt: r.created_at }));
  }
  async setWithdrawalStatus(id: string, status: string, reviewedBy: string, payoutReference: string | null) {
    await this.pool.query(`UPDATE withdrawal_requests SET status = $2, reviewed_by = $3, payout_reference = $4, updated_at = now() WHERE id = $1`, [id, status, reviewedBy, payoutReference]);
    return this.getWithdrawal(id);
  }
  async createRefund(refund: Omit<RefundRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO ride_refunds (payment_id, ride_id, amount_minor, commission_reversed_minor, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [refund.paymentId, refund.rideId, refund.amountMinor, refund.commissionReversedMinor, refund.reason, refund.createdBy]);
    const r = rows[0];
    return { id: r.id, paymentId: r.payment_id, rideId: r.ride_id, amountMinor: r.amount_minor, commissionReversedMinor: r.commission_reversed_minor, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at };
  }
  async listRefundsByPayment(paymentId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ride_refunds WHERE payment_id = $1 ORDER BY created_at`, [paymentId]);
    return rows.map((r: any) => ({ id: r.id, paymentId: r.payment_id, rideId: r.ride_id, amountMinor: r.amount_minor, commissionReversedMinor: r.commission_reversed_minor, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at }));
  }
  async getSetting(key: string) {
    const { rows } = await this.pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
    if (!rows[0]) return null;
    const v = rows[0].value;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  async setSetting(key: string, value: string, changedBy: string | null) {
    await this.pool.query(
      `INSERT INTO system_settings (key, value, changed_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, changed_by = EXCLUDED.changed_by, updated_at = now()`,
      [key, JSON.stringify(value), changedBy]);
  }

  // ---- Support / safety (Phase 14) ----
  async createRating(rating: Omit<RatingRecord, 'id' | 'createdAt'>) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ratings (ride_id, rater_user_id, rater_role, rated_user_id, stars, comment, report_reason) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [rating.rideId, rating.raterUserId, rating.raterRole, rating.ratedUserId, rating.stars, rating.comment, rating.reportReason]);
      const r = rows[0];
      return { id: r.id, rideId: r.ride_id, raterUserId: r.rater_user_id, raterRole: r.rater_role, ratedUserId: r.rated_user_id, stars: r.stars, comment: r.comment, reportReason: r.report_reason, createdAt: r.created_at };
    } catch (e: any) {
      if (e?.code === '23505') throw new Error('DUPLICATE_RATING');
      throw e;
    }
  }
  async getRatingByRideAndRole(rideId: string, raterRole: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ratings WHERE ride_id = $1 AND rater_role = $2`, [rideId, raterRole]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, raterUserId: r.rater_user_id, raterRole: r.rater_role, ratedUserId: r.rated_user_id, stars: r.stars, comment: r.comment, reportReason: r.report_reason, createdAt: r.created_at };
  }
  async createTicket(ticket: Omit<SupportTicketRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO support_tickets (ride_id, reporter_user_id, category, subject, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ticket.rideId, ticket.reporterUserId, ticket.category, ticket.subject, ticket.status]);
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, category: r.category, subject: r.subject, status: r.status, createdAt: r.created_at };
  }
  async getTicket(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, category: r.category, subject: r.subject, status: r.status, createdAt: r.created_at };
  }
  async listTickets(reporterUserId: string | null, status: string | null) {
    const { rows } = await this.pool.query(
      `SELECT * FROM support_tickets WHERE ($1::uuid IS NULL OR reporter_user_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC`,
      [reporterUserId, status]);
    return rows.map((r: any) => ({ id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, category: r.category, subject: r.subject, status: r.status, createdAt: r.created_at }));
  }
  async setTicketStatus(id: string, status: string) {
    await this.pool.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
    return this.getTicket(id);
  }
  async addTicketMessage(message: Omit<TicketMessageRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO ticket_messages (ticket_id, author_user_id, author_role, message) VALUES ($1, $2, $3, $4) RETURNING *`,
      [message.ticketId, message.authorUserId, message.authorRole, message.message]);
    const r = rows[0];
    return { id: r.id, ticketId: r.ticket_id, authorUserId: r.author_user_id, authorRole: r.author_role, message: r.message, createdAt: r.created_at };
  }
  async listTicketMessages(ticketId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]);
    return rows.map((r: any) => ({ id: r.id, ticketId: r.ticket_id, authorUserId: r.author_user_id, authorRole: r.author_role, message: r.message, createdAt: r.created_at }));
  }
  async createIncident(incident: Omit<SafetyIncidentRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO safety_incidents (ride_id, reporter_user_id, priority, status, snapshot, note) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [incident.rideId, incident.reporterUserId, incident.priority, incident.status, incident.snapshot, incident.note]);
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, priority: r.priority, status: r.status, snapshot: JSON.stringify(r.snapshot), note: r.note, resolutionNote: r.resolution_note, createdAt: r.created_at };
  }
  async getOpenIncidentByRide(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM safety_incidents WHERE ride_id = $1 AND status = 'OPEN' ORDER BY created_at DESC LIMIT 1`, [rideId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, priority: r.priority, status: r.status, snapshot: JSON.stringify(r.snapshot), note: r.note, resolutionNote: r.resolution_note, createdAt: r.created_at };
  }
  async getIncident(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM safety_incidents WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, priority: r.priority, status: r.status, snapshot: JSON.stringify(r.snapshot), note: r.note, resolutionNote: r.resolution_note, createdAt: r.created_at };
  }
  async listIncidents(status: string | null) {
    const { rows } = await this.pool.query(
      `SELECT * FROM safety_incidents WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC`, [status]);
    return rows.map((r: any) => ({ id: r.id, rideId: r.ride_id, reporterUserId: r.reporter_user_id, priority: r.priority, status: r.status, snapshot: JSON.stringify(r.snapshot), note: r.note, resolutionNote: r.resolution_note, createdAt: r.created_at }));
  }
  async resolveIncident(id: string, resolutionNote: string) {
    await this.pool.query(`UPDATE safety_incidents SET status = 'RESOLVED', resolution_note = $2, resolved_at = now() WHERE id = $1`, [id, resolutionNote]);
    return this.getIncident(id);
  }
  async createShareLink(link: Omit<ShareLinkRecord, 'id' | 'createdAt'>) {
    const { rows } = await this.pool.query(
      `INSERT INTO share_links (ride_id, created_by, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING *`,
      [link.rideId, link.createdBy, link.tokenHash, link.expiresAt]);
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, createdBy: r.created_by, tokenHash: r.token_hash, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at };
  }
  async getShareLinkByTokenHash(tokenHash: string) {
    const { rows } = await this.pool.query(`SELECT * FROM share_links WHERE token_hash = $1`, [tokenHash]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, createdBy: r.created_by, tokenHash: r.token_hash, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at };
  }
  async listShareLinksByRide(rideId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM share_links WHERE ride_id = $1 ORDER BY created_at DESC`, [rideId]);
    return rows.map((r: any) => ({ id: r.id, rideId: r.ride_id, createdBy: r.created_by, tokenHash: r.token_hash, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at }));
  }
  async revokeShareLink(id: string) {
    await this.pool.query(`UPDATE share_links SET revoked_at = now() WHERE id = $1`, [id]);
    const { rows } = await this.pool.query(`SELECT * FROM share_links WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, rideId: r.ride_id, createdBy: r.created_by, tokenHash: r.token_hash, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at };
  }
  async listCancelledRides(since: Date): Promise<CancelledRideEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT r.id AS ride_id, r.customer_id, r.driver_id, r.status, h.actor_id, h.actor_role, h.reason, h.created_at AS cancelled_at
       FROM rides r JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = r.status
       WHERE r.status LIKE 'CANCELLED%' AND h.created_at >= $1 ORDER BY h.created_at DESC`, [since]);
    return rows.map((r: any) => ({ rideId: r.ride_id, customerId: r.customer_id, driverId: r.driver_id, status: r.status, actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, cancelledAt: r.cancelled_at }));
  }
  async countCancelsByActorSince(actorId: string, since: Date) {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS count FROM ride_status_history WHERE actor_id = $1 AND to_status LIKE 'CANCELLED%' AND created_at >= $2`,
      [actorId, since]);
    return Number(rows[0].count);
  }
  async setUserStatus(id: string, status: string, reason: string | null) {
    await this.pool.query(`UPDATE users SET status = $2, suspension_reason = $3, updated_at = now() WHERE id = $1`, [id, status, reason]);
    return this.getUserById(id);
  }

  // ---- Analytics (Phase 15; on-read aggregates, no separate ETL) ----
  async getRideStats(since: Date): Promise<RideStats> {
    const requested = Number((await this.pool.query(`SELECT COUNT(*) AS count FROM ride_requests WHERE created_at >= $1`, [since])).rows[0].count);
    const completedRow = await this.pool.query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(r.final_fare_minor), 0) AS avg_fare, COALESCE(SUM(r.commission_minor), 0) AS commission
       FROM rides r JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED'
       WHERE r.status = 'COMPLETED' AND h.created_at >= $1`, [since]);
    const cancelled = Number((await this.pool.query(
      `SELECT COUNT(*) AS count FROM ride_requests WHERE created_at >= $1 AND status LIKE 'CANCELLED%'`, [since])).rows[0].count);
    const noDriverFound = Number((await this.pool.query(
      `SELECT COUNT(*) AS count FROM ride_requests WHERE created_at >= $1 AND status = 'NO_DRIVER_FOUND'`, [since])).rows[0].count);
    const c = completedRow.rows[0];
    return {
      requested,
      completed: Number(c.count),
      cancelled,
      noDriverFound,
      avgFareMinor: Number(c.count) > 0 ? Math.round(Number(c.avg_fare)) : null,
      totalCommissionMinor: Number(c.commission),
    };
  }
  async getDispatchStats(since: Date): Promise<DispatchStats> {
    const attempts = await this.pool.query(
      `SELECT outcome, radius_km, score FROM dispatch_attempts WHERE created_at >= $1`, [since]);
    const byOutcome: Record<string, number> = {};
    const byRadius: Record<string, number> = {};
    let scoreSum = 0;
    for (const r of attempts.rows) {
      byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
      byRadius[String(Number(r.radius_km))] = (byRadius[String(Number(r.radius_km))] ?? 0) + 1;
      scoreSum += Number(r.score);
    }
    const offers = await this.pool.query(
      `SELECT COUNT(*) AS sent, COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted FROM ride_offers WHERE created_at >= $1`, [since]);
    const match = await this.pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (sel.created_at - sea.created_at))) AS avg_seconds
       FROM request_status_history sea
       JOIN request_status_history sel ON sel.request_id = sea.request_id AND sel.to_status = 'DRIVER_SELECTED'
       WHERE sea.to_status = 'SEARCHING' AND sel.created_at >= $1`, [since]);
    return {
      attempts: attempts.rows.length,
      byOutcome,
      avgScore: attempts.rows.length > 0 ? Math.round((scoreSum / attempts.rows.length) * 10000) / 10000 : null,
      byRadius,
      avgMatchSeconds: match.rows[0].avg_seconds !== null ? Math.round(Number(match.rows[0].avg_seconds) * 100) / 100 : null,
      offersSent: Number(offers.rows[0].sent),
      offersAccepted: Number(offers.rows[0].accepted),
    };
  }
  async getCityStats(since: Date): Promise<CityStatRow[]> {
    const { rows } = await this.pool.query(
      `SELECT c.id AS city_id, c.name AS city_name,
        COUNT(DISTINCT rr.id) FILTER (WHERE rr.created_at >= $1) AS requested,
        COUNT(DISTINCT rr.id) FILTER (WHERE rr.created_at >= $1 AND rr.status LIKE 'CANCELLED%') AS cancelled,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'COMPLETED' AND h.created_at >= $1) AS completed,
        COALESCE(SUM(r.commission_minor) FILTER (WHERE r.status = 'COMPLETED' AND h.created_at >= $1), 0) AS commission,
        AVG(r.final_fare_minor) FILTER (WHERE r.status = 'COMPLETED' AND h.created_at >= $1 AND r.final_fare_minor > 0) AS avg_fare
       FROM cities c
       LEFT JOIN ride_requests rr ON rr.city_id = c.id
       LEFT JOIN rides r ON r.request_id = rr.id
       LEFT JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED'
       GROUP BY c.id, c.name ORDER BY c.name`, [since]);
    return rows.map((r: any) => ({
      cityId: r.city_id, cityName: r.city_name,
      requested: Number(r.requested), completed: Number(r.completed), cancelled: Number(r.cancelled),
      commissionMinor: Number(r.commission),
      avgFareMinor: r.avg_fare !== null ? Math.round(Number(r.avg_fare)) : null,
    }));
  }
  async getDriverLeaderboard(since: Date, limit: number): Promise<DriverLeaderRow[]> {
    const { rows } = await this.pool.query(
      `SELECT r.driver_id,
        COUNT(*) AS completed,
        COALESCE(SUM(r.final_fare_minor - COALESCE(r.commission_minor, 0)), 0) AS earnings,
        (SELECT AVG(stars) FROM ratings WHERE rated_user_id = r.driver_id AND created_at >= $1) AS avg_rating,
        (SELECT COUNT(*) FROM ride_offers WHERE driver_id = r.driver_id AND created_at >= $1) AS offers_sent,
        (SELECT COUNT(*) FROM ride_offers WHERE driver_id = r.driver_id AND created_at >= $1 AND status = 'ACCEPTED') AS offers_accepted
       FROM rides r JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED'
       WHERE r.status = 'COMPLETED' AND h.created_at >= $1 AND r.driver_id IS NOT NULL
       GROUP BY r.driver_id ORDER BY completed DESC, earnings DESC LIMIT $2`, [since, limit]);
    return rows.map((r: any) => ({
      driverUserId: r.driver_id,
      completedRides: Number(r.completed),
      earningsMinor: Number(r.earnings),
      avgRating: r.avg_rating !== null ? Math.round(Number(r.avg_rating) * 100) / 100 : null,
      acceptanceRate: Number(r.offers_sent) > 0 ? Math.round((Number(r.offers_accepted) / Number(r.offers_sent)) * 100) / 100 : null,
    }));
  }
  async getDailySeries(since: Date): Promise<DailyRow[]> {
    const { rows } = await this.pool.query(
      `SELECT d AS date,
        (SELECT COUNT(*) FROM ride_requests WHERE DATE(created_at) = d AND created_at >= $1) AS requested,
        (SELECT COUNT(*) FROM ride_status_history WHERE to_status = 'COMPLETED' AND DATE(created_at) = d AND created_at >= $1) AS completed,
        (SELECT COALESCE(SUM(r.commission_minor), 0) FROM rides r JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED' WHERE DATE(h.created_at) = d AND h.created_at >= $1) AS commission
       FROM generate_series(DATE($1), CURRENT_DATE, INTERVAL '1 day') AS d ORDER BY d`, [since]);
    return rows.map((r: any) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      requested: Number(r.requested), completed: Number(r.completed), commissionMinor: Number(r.commission),
    }));
  }
  async getDriverTripsInCityToday(driverUserId: string, cityId: string, dayStart: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS count FROM rides r
       JOIN ride_requests rr ON rr.id = r.request_id
       JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED'
       WHERE r.driver_id = $1 AND rr.city_id = $2 AND h.created_at >= $3`,
      [driverUserId, cityId, dayStart]);
    return Number(rows[0].count);
  }
  async getCityFairness(cityId: string, dayStart: Date): Promise<CityFairness> {
    const { rows } = await this.pool.query(
      `SELECT r.driver_id, COUNT(*) AS trips FROM rides r
       JOIN ride_requests rr ON rr.id = r.request_id
       JOIN ride_status_history h ON h.ride_id = r.id AND h.to_status = 'COMPLETED'
       WHERE rr.city_id = $1 AND h.created_at >= $2 AND r.driver_id IS NOT NULL
       GROUP BY r.driver_id ORDER BY trips DESC`, [cityId, dayStart]);
    const drivers = rows.map((r: any) => ({ driverUserId: r.driver_id, tripsToday: Number(r.trips) }));
    return {
      cityId,
      cityMaxTripsToday: drivers.reduce((max, d) => Math.max(max, d.tripsToday), 0),
      drivers,
    };
  }
}
