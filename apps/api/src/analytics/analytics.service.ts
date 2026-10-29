import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { STORE, type Store } from '../data/store.interface';

/**
 * Phase 15 analytics. Every number is an on-read aggregate over the
 * real tables (rides, requests, history, offers, ratings) — there is
 * no separate analytics pipeline and no sampled or estimated data.
 * "Today" and window boundaries are UTC, matching the timestamps
 * the stores record.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(STORE) private readonly store: Store) {}

  /** days must be 1..365; returns the window start (UTC midnight). */
  windowStart(days: number): Date {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException('days must be an integer between 1 and 365');
    }
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return start;
  }

  todayStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  async overview(days: number) {
    const since = this.windowStart(days);
    const stats = await this.store.getRideStats(since);
    const dispatch = await this.store.getDispatchStats(since);
    return {
      periodDays: days,
      since: since.toISOString(),
      ridesRequested: stats.requested,
      ridesCompleted: stats.completed,
      ridesCancelled: stats.cancelled,
      noDriverFound: stats.noDriverFound,
      completionRate: stats.requested > 0
        ? Math.round((stats.completed / stats.requested) * 100) / 100 : null,
      avgFareMinor: stats.avgFareMinor,
      totalCommissionMinor: stats.totalCommissionMinor,
      offerAcceptanceRate: dispatch.offersSent > 0
        ? Math.round((dispatch.offersAccepted / dispatch.offersSent) * 100) / 100 : null,
    };
  }

  async dispatch(days: number) {
    const since = this.windowStart(days);
    const stats = await this.store.getDispatchStats(since);
    return {
      periodDays: days,
      attempts: stats.attempts,
      byOutcome: stats.byOutcome,
      byRadiusKm: stats.byRadius,
      avgScore: stats.avgScore,
      avgMatchSeconds: stats.avgMatchSeconds,
      offersSent: stats.offersSent,
      offersAccepted: stats.offersAccepted,
      offerAcceptanceRate: stats.offersSent > 0
        ? Math.round((stats.offersAccepted / stats.offersSent) * 100) / 100 : null,
    };
  }

  async cities(days: number) {
    return this.store.getCityStats(this.windowStart(days));
  }

  async drivers(days: number, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }
    return this.store.getDriverLeaderboard(this.windowStart(days), limit);
  }

  async daily(days: number) {
    return this.store.getDailySeries(this.windowStart(days));
  }

  async fairness(cityId: string) {
    const cities = await this.store.listCities();
    const city = cities.find((c) => c.id === cityId);
    if (!city) throw new NotFoundException('City not found');
    const fairness = await this.store.getCityFairness(cityId, this.todayStart());
    return { cityName: city.name, ...fairness };
  }
}
