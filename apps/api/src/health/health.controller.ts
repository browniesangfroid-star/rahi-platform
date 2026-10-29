import { Controller, Get, Inject } from '@nestjs/common';
import { STORE, type Store } from '../data/store.interface';

@Controller('health')
export class HealthController {
  constructor(@Inject(STORE) private readonly store: Store) {}

  @Get()
  liveness() {
    return { data: { status: 'ok', service: 'rahi-api' } };
  }

  @Get('ready')
  async readiness() {
    // Phase 17: readiness now actually probes the database. Redis is
    // reported as configured/unconfigured (presence of REDIS_URL),
    // not probed — a failed Redis must not take a healthy API out of
    // rotation while its fallbacks (in-memory index, in-memory
    // limiter) still serve single-instance traffic.
    const databaseOk = await this.store.ping();
    return {
      data: {
        status: databaseOk ? 'ready' : 'not-ready',
        checks: {
          database: databaseOk ? 'ok' : 'unreachable',
          redis: process.env.REDIS_URL ? 'configured' : 'not-configured',
        },
      },
    };
  }
}
