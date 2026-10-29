/** Sliding-window in-memory limiter: 5 OTP requests per phone per 15 min.
 *  Dev/test default. Production uses RedisOtpRateLimiter via the
 *  OTP_RATE_LIMITER token (DataModule) so the count is shared
 *  across API instances. */
export const OTP_RATE_LIMITER = 'OTP_RATE_LIMITER';

export class OtpRateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit = 5;
  private readonly windowMs = 15 * 60 * 1000;

  async allow(key: string): Promise<boolean> {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  async reset() { this.hits.clear(); }
}
