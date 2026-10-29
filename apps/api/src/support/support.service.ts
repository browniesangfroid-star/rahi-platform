import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { generatePin } from '../trips/pin';

/**
 * Phase 14 — support and safety.
 *
 * Rules that matter (see BUSINESS-RULES.md):
 * - Ratings only after COMPLETED, within 7 days, once per direction.
 *   A rating that carries a report creates a support ticket
 *   automatically — the report is never just a comment.
 * - A driver rating updates the dispatch aggregates (ratingSum /
 *   ratingCount), so ratings actually change future matching.
 * - SOS creates a HIGH-priority incident with a snapshot of the
 *   ride, driver, vehicle and last known location. It does NOT
 *   claim to contact police: there is no such integration, and the
 *   incident is routed to ops through the incidents queue.
 * - Share-trip links are time-limited and token-hashed, and the
 *   public view shows only the live trip — no names, no phone
 *   numbers, no history.
 * - PIN admin reset issues a fresh PIN (old PIN stops working) and
 *   is audit-logged; the plaintext is returned once, to the admin,
 *   who relays it out of band.
 */
export const RATING_WINDOW_DAYS = 7;
export const REPEAT_CANCEL_THRESHOLD = 3;
export const REVIEW_WINDOW_DAYS = 7;

const TERMINAL_RIDE_STATUSES = ['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'];

@Injectable()
export class SupportService {
  constructor(@Inject(STORE) private readonly store: Store) {}

  private async loadRideForParticipant(rideId: string, userId: string, isAdmin: boolean) {
    const ride = await this.store.getRideById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (!isAdmin && ride.customerId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException('Only the ride participants can do this');
    }
    return ride;
  }

  private roleOf(ride: { customerId: string; driverId: string | null }, userId: string): 'CUSTOMER' | 'DRIVER' {
    return ride.customerId === userId ? 'CUSTOMER' : 'DRIVER';
  }

  // ---- Ratings ----
  async rateRide(userId: string, rideId: string, stars: number, comment: string | null, reportReason: string | null) {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new BadRequestException('Stars must be an integer between 1 and 5');
    }
    const ride = await this.loadRideForParticipant(rideId, userId, false);
    if (ride.status !== 'COMPLETED') {
      throw new ConflictException(`Only completed rides can be rated (currently ${ride.status})`);
    }
    const history = await this.store.listRideHistory(rideId);
    const completedAt = history.find((h) => h.toStatus === 'COMPLETED')?.createdAt;
    if (!completedAt) throw new ConflictException('No completion was recorded for this ride');
    const ageDays = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > RATING_WINDOW_DAYS) {
      throw new ConflictException(`Ratings close ${RATING_WINDOW_DAYS} days after completion`);
    }
    const raterRole = this.roleOf(ride, userId);
    const existing = await this.store.getRatingByRideAndRole(rideId, raterRole);
    if (existing) throw new ConflictException('This ride has already been rated in this direction');
    const ratedUserId = raterRole === 'CUSTOMER' ? ride.driverId : ride.customerId;
    if (!ratedUserId) throw new ConflictException('Ride has no counterpart to rate');
    const rating = await this.store.createRating({
      rideId, raterUserId: userId, raterRole, ratedUserId, stars,
      comment, reportReason,
    });
    // Driver ratings feed dispatch ranking.
    if (raterRole === 'CUSTOMER' && ride.driverId) {
      const stats = await this.store.getDriverStats(ride.driverId);
      await this.store.setDriverStats({
        ...stats, ratingSum: stats.ratingSum + stars, ratingCount: stats.ratingCount + 1,
      });
    }
    // A report is never just a comment: it opens a ticket.
    let ticket = null;
    if (reportReason && reportReason.trim().length > 0) {
      ticket = await this.store.createTicket({
        rideId, reporterUserId: userId, category: 'REPORT',
        subject: `Report on ride ${rideId.slice(0, 8)}: ${reportReason.trim().slice(0, 120)}`,
        status: 'OPEN',
      });
      await this.store.addTicketMessage({
        ticketId: ticket.id, authorUserId: userId, authorRole: raterRole,
        message: `Report: ${reportReason.trim()}${comment ? `\nComment: ${comment}` : ''}`,
      });
    }
    return { rating, ticket };
  }

  // ---- Tickets ----
  async createTicket(userId: string, input: { rideId: string | null; category: string; subject: string; message: string }) {
    if (!['RIDE_ISSUE', 'PAYMENT', 'SAFETY', 'ACCOUNT', 'OTHER'].includes(input.category)) {
      throw new BadRequestException(`Unknown ticket category ${input.category}`);
    }
    if (!input.subject.trim() || !input.message.trim()) {
      throw new BadRequestException('Ticket subject and message are required');
    }
    let authorRole = 'CUSTOMER';
    if (input.rideId) {
      const ride = await this.loadRideForParticipant(input.rideId, userId, false);
      authorRole = this.roleOf(ride, userId);
    }
    const ticket = await this.store.createTicket({
      rideId: input.rideId, reporterUserId: userId, category: input.category,
      subject: input.subject.trim(), status: 'OPEN',
    });
    await this.store.addTicketMessage({
      ticketId: ticket.id, authorUserId: userId, authorRole,
      message: input.message.trim(),
    });
    return ticket;
  }

  async listTickets(userId: string, isSupport: boolean, status: string | null) {
    const tickets = await this.store.listTickets(isSupport ? null : userId, status);
    return tickets;
  }

  async getTicketWithMessages(userId: string, isSupport: boolean, ticketId: string) {
    const ticket = await this.store.getTicket(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!isSupport && ticket.reporterUserId !== userId) {
      throw new ForbiddenException('Only the reporter or support can view this ticket');
    }
    const messages = await this.store.listTicketMessages(ticketId);
    return { ticket, messages };
  }

  async replyToTicket(userId: string, isSupport: boolean, ticketId: string, message: string) {
    const ticket = await this.store.getTicket(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!isSupport && ticket.reporterUserId !== userId) {
      throw new ForbiddenException('Only the reporter or support can reply to this ticket');
    }
    if (ticket.status === 'CLOSED') throw new ConflictException('Closed tickets cannot receive replies');
    if (!message.trim()) throw new BadRequestException('Reply message is required');
    let authorRole = 'CUSTOMER';
    if (isSupport) authorRole = 'SUPPORT';
    else if (ticket.rideId) {
      const ride = await this.store.getRideById(ticket.rideId);
      if (ride) authorRole = this.roleOf(ride, userId);
    }
    return this.store.addTicketMessage({
      ticketId, authorUserId: userId, authorRole, message: message.trim(),
    });
  }

  async setTicketStatus(supportId: string, ticketId: string, status: string) {
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
      throw new BadRequestException(`Unknown ticket status ${status}`);
    }
    const ticket = await this.store.getTicket(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    const updated = await this.store.setTicketStatus(ticketId, status);
    await this.store.addAuditLog({
      actorId: supportId, action: `ticket.${status.toLowerCase()}`, targetType: 'ticket',
      targetId: ticketId, beforeSummary: JSON.stringify({ status: ticket.status }),
      afterSummary: JSON.stringify({ status }), reason: null,
    });
    return updated;
  }

  // ---- SOS / safety incidents ----
  async createSos(userId: string, rideId: string, note: string | null) {
    const ride = await this.loadRideForParticipant(rideId, userId, false);
    if (TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      throw new ConflictException(`SOS is only available during a live trip (currently ${ride.status})`);
    }
    const existing = await this.store.getOpenIncidentByRide(rideId);
    if (existing) return existing;
    const latestLocation = await this.store.getLatestRideLocation(rideId);
    const snapshot = {
      rideId: ride.id, rideStatus: ride.status, customerId: ride.customerId,
      driverId: ride.driverId, vehicleId: ride.vehicleId,
      lastLocation: latestLocation ? { lat: latestLocation.lat, lng: latestLocation.lng, recordedAt: latestLocation.recordedAt } : null,
      reportedBy: userId, reportedAt: new Date().toISOString(),
    };
    return this.store.createIncident({
      rideId, reporterUserId: userId, priority: 'HIGH', status: 'OPEN',
      snapshot: JSON.stringify(snapshot), note: note?.trim() || null, resolutionNote: null,
    });
  }

  async listIncidents(status: string | null) {
    return this.store.listIncidents(status);
  }

  async resolveIncident(supportId: string, incidentId: string, resolutionNote: string) {
    const incident = await this.store.getIncident(incidentId);
    if (!incident) throw new NotFoundException('Incident not found');
    if (incident.status === 'RESOLVED') throw new ConflictException('Incident is already resolved');
    if (!resolutionNote.trim()) throw new BadRequestException('A resolution note is required');
    const resolved = await this.store.resolveIncident(incidentId, resolutionNote.trim());
    await this.store.addAuditLog({
      actorId: supportId, action: 'incident.resolved', targetType: 'incident',
      targetId: incidentId, beforeSummary: JSON.stringify({ status: 'OPEN' }),
      afterSummary: JSON.stringify({ status: 'RESOLVED' }), reason: null,
    });
    return resolved;
  }

  // ---- Share-trip links ----
  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async createShareLink(userId: string, rideId: string, ttlMinutes: number) {
    const ride = await this.loadRideForParticipant(rideId, userId, false);
    if (TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      throw new ConflictException('Only a live trip can be shared');
    }
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 24 * 60) {
      throw new BadRequestException('Share link lifetime must be between 5 minutes and 24 hours');
    }
    const token = randomBytes(32).toString('hex');
    const link = await this.store.createShareLink({
      rideId, createdBy: userId, tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000), revokedAt: null,
    });
    return { id: link.id, rideId, token, expiresAt: link.expiresAt };
  }

  async revokeShareLink(userId: string, rideId: string, linkId: string) {
    const ride = await this.loadRideForParticipant(rideId, userId, false);
    const links = await this.store.listShareLinksByRide(ride.id);
    const link = links.find((l) => l.id === linkId);
    if (!link) throw new NotFoundException('Share link not found');
    return this.store.revokeShareLink(linkId);
  }

  async viewSharedTrip(token: string) {
    const link = await this.store.getShareLinkByTokenHash(this.hashToken(token));
    if (!link) throw new NotFoundException('Share link not found');
    if (link.revokedAt) throw new GoneException('This share link was revoked');
    if (link.expiresAt.getTime() < Date.now()) throw new GoneException('This share link has expired');
    const ride = await this.store.getRideById(link.rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      throw new GoneException('This trip has ended');
    }
    const latestLocation = await this.store.getLatestRideLocation(ride.id);
    // Deliberately minimal: status + live location only. No names,
    // no phone numbers, no pickup/destination addresses, no history.
    return {
      rideId: ride.id, status: ride.status,
      latestLocation: latestLocation ? { lat: latestLocation.lat, lng: latestLocation.lng, recordedAt: latestLocation.recordedAt } : null,
      expiresAt: link.expiresAt,
    };
  }

  // ---- Admin PIN reset ----
  async resetPin(adminId: string, rideId: string) {
    const ride = await this.store.getRideById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    const pin = await this.store.getRidePin(rideId);
    if (!pin) throw new NotFoundException('No PIN was issued for this ride');
    if (pin.verifiedAt) throw new ConflictException('PIN was already verified');
    if (TERMINAL_RIDE_STATUSES.includes(ride.status)) {
      throw new ConflictException(`PIN cannot be reset in status ${ride.status}`);
    }
    const fresh = generatePin();
    await this.store.createRidePin({ rideId, pinHash: fresh.hash, attempts: 0, verifiedAt: null });
    await this.store.addAuditLog({
      actorId: adminId, action: 'pin.reset', targetType: 'ride', targetId: rideId,
      beforeSummary: null, afterSummary: JSON.stringify({ pinReset: true }), reason: null,
    });
    return { pin: fresh.pin, rideId };
  }

  // ---- Cancellation / no-show review queue ----
  async getReviewQueue() {
    const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const cancelled = await this.store.listCancelledRides(since);
    const out = [];
    for (const entry of cancelled) {
      const actorId = entry.actorId;
      const cancelCount = actorId ? await this.store.countCancelsByActorSince(actorId, since) : 0;
      out.push({
        ...entry,
        cancelCount7d: cancelCount,
        flaggedRepeat: cancelCount >= REPEAT_CANCEL_THRESHOLD,
        isNoShow: entry.reason === 'NO_SHOW',
      });
    }
    return out;
  }

  // ---- User suspension (support action) ----
  async suspendUser(adminId: string, userId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('A suspension reason is required');
    const user = await this.store.setUserStatus(userId, 'SUSPENDED', reason.trim());
    if (!user) throw new NotFoundException('User not found');
    await this.store.addAuditLog({
      actorId: adminId, action: 'user.suspended', targetType: 'user', targetId: userId,
      beforeSummary: null, afterSummary: JSON.stringify({ status: 'SUSPENDED' }), reason: reason.trim(),
    });
    return user;
  }

  async unsuspendUser(adminId: string, userId: string) {
    const user = await this.store.setUserStatus(userId, 'ACTIVE', null);
    if (!user) throw new NotFoundException('User not found');
    await this.store.addAuditLog({
      actorId: adminId, action: 'user.unsuspended', targetType: 'user', targetId: userId,
      beforeSummary: null, afterSummary: JSON.stringify({ status: 'ACTIVE' }), reason: null,
    });
    return user;
  }
}
