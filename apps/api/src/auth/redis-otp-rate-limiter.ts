import Redis from 'ioredis';

/**
 * Phase 16: the OTP limiter for multi-instance production. Same
 * contract as the in-memory limiter (5 requests per key per 15
 * minutes) but stored in Redis, so every API instance shares the
 * count. The increment + first-hit expiry run as one Lua script,
 * so a crash between INCR and EXPIRE cannot leave a key that
 * never expires.
 *
 * The constructor accepts a client-shaped object so unit tests can
 * substitute a stub without a Redis server.
 */
export class RedisOtpRateLimiter {
  private readonly limit = 5;
  private readonly windowSeconds = 15 * 60;
  private readonly client: Pick<Redis, 'eval'>;

  constructor(urlOrClient: string | Pick<Redis, 'eval'>) {
    this.client = typeof urlOrClient === 'string' ? new Redis(urlOrClient) : urlOrClient;
  }

  async allow(key: string): Promise<boolean> {
    const script = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
      return count
    `;
    const count = (await this.client.eval(script, 1, key, String(this.windowSeconds))) as number;
    return count <= this.limit;
  }

  async reset(): Promise<void> {
    // No-op by design: production keys expire on their own after
    // 15 minutes. Tests reset by using fresh keys.
  }
}
