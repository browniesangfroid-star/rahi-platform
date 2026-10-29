import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';
import { AuthModule } from '../auth/auth.module';
import { ROUTING_PROVIDER } from './routing.provider';
import { HaversineRoutingProvider } from './haversine-routing.provider';
import { OsrmRoutingProvider } from './osrm-routing.provider';

@Module({
  imports: [AuthModule],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    TrackingGateway,
    {
      provide: ROUTING_PROVIDER,
      useFactory: () => {
        if (process.env.MAPS_PROVIDER === 'osrm') {
          const baseUrl = process.env.OSRM_BASE_URL;
          if (!baseUrl) {
            // The public demo server is a shared demo, not a
            // production dependency. Warn loudly; Phase 17 docs
            // describe running your own OSRM instance.
            // eslint-disable-next-line no-console
            console.warn('[routing] MAPS_PROVIDER=osrm without OSRM_BASE_URL: using the public OSRM demo server (DEV ONLY). Point OSRM_BASE_URL at your own instance for production.');
          }
          return new OsrmRoutingProvider(baseUrl ?? 'https://router.project-osrm.org');
        }
        return new HaversineRoutingProvider();
      },
    },
  ],
  exports: [TrackingService, TrackingGateway, ROUTING_PROVIDER],
})
export class TrackingModule {}
