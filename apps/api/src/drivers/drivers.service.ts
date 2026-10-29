import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { LOCATION_INDEX } from '../dispatch/location-index';
import type { LocationIndex } from '../dispatch/location-index';
import { canTransitionKyc, type KycStatus } from '@rahi/shared-types';
import { EncryptionService } from '../crypto/encryption.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

export interface DocumentInput {
  driverUserId: string;
  documentType: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  expiresAt: string | null;
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Driver onboarding + KYC. A driver cannot accept rides until:
 * kycStatus === APPROVED AND an approved vehicle is active.
 * File storage in Phase 5 is local disk under STORAGE_DIR (dev).
 * An S3-compatible provider replaces it in Phase 17; files are never
 * served publicly — only owner or a drivers.approve admin can download.
 */
@Injectable()
export class DriversService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(LOCATION_INDEX) private readonly locationIndex: LocationIndex,
    private readonly crypto: EncryptionService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async register(userId: string, emergencyContactName: string | null, emergencyContactPhone: string | null, bankAccount: string | null) {
    const stored = bankAccount === null ? null : this.crypto.encrypt(bankAccount);
    const profile = await this.store.createDriverProfile(userId, emergencyContactName, emergencyContactPhone, stored);
    // Return the caller's own value, never the stored ciphertext.
    return { profile: { ...profile, bankAccount }, documents: [], vehicles: [], canAcceptRides: false };
  }

  async listQueue(status: string) {
    const profiles = await this.store.listDriverProfilesByKyc(status);
    const out = [];
    for (const profile of profiles) {
      const documents = await this.store.listDriverDocuments(profile.userId);
      const vehicles = await this.store.listVehiclesByOwner(profile.userId);
      out.push({ profile, documentCount: documents.length, vehicleCount: vehicles.length });
    }
    return out;
  }

  /** Online/offline + GPS (Phase 7). Going online requires the same
   *  gate as accepting rides: APPROVED KYC + an active approved vehicle.
   *  Location updates from an offline driver are stored but never
   *  matched, because nearby() filters on online = true. */
  async goOnline(userId: string, lat: number | null, lng: number | null) {
    const status = await this.getStatus(userId);
    if (!status.canAcceptRides) {
      throw new ConflictException('Driver cannot go online: KYC must be approved and an approved vehicle must be active');
    }
    const existing = await this.locationIndex.getDriver(userId);
    const useLat = lat ?? existing?.lat ?? null;
    const useLng = lng ?? existing?.lng ?? null;
    if (useLat === null || useLng === null) {
      throw new BadRequestException('Location is required to go online');
    }
    const stats = await this.store.getDriverStats(userId);
    const rating = stats.ratingCount > 0 ? stats.ratingSum / stats.ratingCount : 5.0;
    const acceptanceRate = stats.offersSent > 0 ? stats.offersAccepted / stats.offersSent : 0.5;
    await this.locationIndex.setDriver({
      driverId: userId,
      cityId: existing?.cityId ?? null,
      categoryCode: status.vehicles.find((v) => v.isActive)?.categoryCode ?? 'BIKE',
      lat: useLat, lng: useLng, lastSeen: new Date(), online: true,
      rating, acceptanceRate, tripsToday: stats.tripsToday,
    });
    return { online: true, canAcceptRides: true };
  }

  async goOffline(userId: string) {
    await this.locationIndex.setOnline(userId, false);
    return { online: false };
  }

  async updateLocation(userId: string, lat: number, lng: number) {
    const status = await this.getStatus(userId);
    const existing = await this.locationIndex.getDriver(userId);
    const stats = await this.store.getDriverStats(userId);
    await this.locationIndex.setDriver({
      driverId: userId,
      cityId: existing?.cityId ?? null,
      categoryCode: status.vehicles.find((v) => v.isActive)?.categoryCode ?? existing?.categoryCode ?? 'BIKE',
      lat, lng, lastSeen: new Date(), online: existing?.online ?? false,
      rating: existing?.rating ?? 5.0,
      acceptanceRate: existing?.acceptanceRate ?? 0.5,
      tripsToday: stats.tripsToday,
    });
    return { online: existing?.online ?? false, lat, lng };
  }

  async getStatus(userId: string) {
    const profile = await this.store.getDriverProfile(userId);
    if (!profile) throw new NotFoundException('Driver profile not found');
    const documents = await this.store.listDriverDocuments(userId);
    const vehicles = await this.store.listVehiclesByOwner(userId);
    const canAcceptRides = profile.kycStatus === 'APPROVED' &&
      vehicles.some((v) => v.isActive && v.approvalStatus === 'APPROVED');
    const history = await this.store.listDriverHistory(userId);
    // Copy before decrypting: the stored record must keep ciphertext.
    return { profile: { ...profile, bankAccount: this.crypto.decryptMaybe(profile.bankAccount) }, documents, vehicles, canAcceptRides, history };
  }

  private async transition(userId: string, to: KycStatus, actorId: string | null, actorRole: string | null, reason: string | null) {
    const profile = await this.store.getDriverProfile(userId);
    if (!profile) throw new NotFoundException('Driver profile not found');
    const from = profile.kycStatus as KycStatus;
    if (!canTransitionKyc(from, to)) {
      throw new ConflictException(`Illegal KYC transition: ${from} -> ${to}`);
    }
    await this.store.setDriverKycStatus(userId, to, reason);
    await this.store.addDriverHistory({ driverUserId: userId, fromStatus: from, toStatus: to, actorId, actorRole, reason });
    await this.store.addAuditLog({ actorId, action: `driver.kyc.${to.toLowerCase()}`, targetType: 'driver', targetId: userId, beforeSummary: null, afterSummary: null, reason });
    return this.getStatus(userId);
  }

  async submit(userId: string) {
    return this.transition(userId, 'SUBMITTED', userId, 'DRIVER', null);
  }
  async startReview(userId: string, adminId: string) {
    return this.transition(userId, 'UNDER_REVIEW', adminId, 'ADMIN', null);
  }
  async approve(userId: string, adminId: string) {
    const profile = await this.store.getDriverProfile(userId);
    if (!profile) throw new NotFoundException('Driver profile not found');
    if (profile.kycStatus !== 'UNDER_REVIEW') {
      throw new ConflictException(`Driver must be UNDER_REVIEW to approve (currently ${profile.kycStatus})`);
    }
    const documents = await this.store.listDriverDocuments(userId);
    const types = new Set(documents.map((d) => d.documentType));
    const missing = ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION'].filter((t) => !types.has(t));
    const vehicles = await this.store.listVehiclesByOwner(userId);
    if (missing.length > 0 || vehicles.length === 0) {
      throw new ConflictException(`Cannot approve: missing ${missing.join(', ') || 'vehicle'}`);
    }
    return this.transition(userId, 'APPROVED', adminId, 'ADMIN', null);
  }
  async reject(userId: string, adminId: string, reason: string) {
    return this.transition(userId, 'REJECTED', adminId, 'ADMIN', reason);
  }
  async requestChanges(userId: string, adminId: string, reason: string) {
    // Request-changes is modelled as REJECTED with a reason in Phase 5;
    // the driver resubmits via SUBMITTED. A distinct REQUEST_CHANGES state
    // would need a new enum value in migration 005 (Phase 14 hardening).
    return this.transition(userId, 'REJECTED', adminId, 'ADMIN', reason);
  }
  async suspend(userId: string, adminId: string, reason: string) {
    return this.transition(userId, 'SUSPENDED', adminId, 'ADMIN', reason);
  }
  async reinstate(userId: string, adminId: string) {
    return this.transition(userId, 'APPROVED', adminId, 'ADMIN', null);
  }

  async addDocument(input: DocumentInput) {
    const ext = path.extname(input.originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ConflictException(`File type not allowed: ${ext || '(none)'}. Allowed: jpg, png, pdf.`);
    }
    if (input.buffer.length > MAX_FILE_BYTES) {
      throw new ConflictException('File too large (max 10 MB).');
    }
    const key = `${input.driverUserId}/${Date.now()}-${input.documentType}${ext}`;
    await this.storage.put(key, input.buffer, input.mimeType);
    return this.store.addDriverDocument({
      driverUserId: input.driverUserId,
      documentType: input.documentType,
      storageKey: key,
      mimeType: input.mimeType,
      expiresAt: input.expiresAt,
    });
  }

  async downloadDocument(documentId: string, requesterId: string, requesterIsAdmin: boolean) {
    const doc = await this.store.getDriverDocument(documentId);
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.driverUserId !== requesterId && !requesterIsAdmin) {
      throw new ForbiddenException('Not authorised to view this document');
    }
    const buffer = await this.storage.get(doc.storageKey);
    return { doc, buffer };
  }

  async createVehicle(userId: string, input: { categoryCode: string; make: string; model: string; year: number; color: string; registrationNumber: string }) {
    const profile = await this.store.getDriverProfile(userId);
    if (!profile) throw new NotFoundException('Driver profile not found — register first');
    return this.store.createVehicle({ ownerUserId: userId, ...input });
  }

  async approveVehicle(vehicleId: string) {
    const vehicle = await this.store.getVehicle(vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return this.store.setVehicleApproval(vehicleId, 'APPROVED');
  }

  async activateVehicle(userId: string, vehicleId: string) {
    const vehicle = await this.store.getVehicle(vehicleId);
    if (!vehicle || vehicle.ownerUserId !== userId) throw new NotFoundException('Vehicle not found');
    if (vehicle.approvalStatus !== 'APPROVED') {
      throw new ConflictException('Only an approved vehicle can be activated');
    }
    return this.store.setActiveVehicle(userId, vehicleId);
  }
}
