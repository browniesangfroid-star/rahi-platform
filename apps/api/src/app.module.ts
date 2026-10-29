import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { BootstrapController } from './bootstrap/bootstrap.controller';
import { DataModule } from './data/data.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { OffersModule } from './offers/offers.module';
import { TrackingModule } from './tracking/tracking.module';
import { TripsModule } from './trips/trips.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { SupportModule } from './support/support.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [DataModule, AuthModule, UsersModule, RbacModule, DriversModule, RidesModule, DispatchModule, OffersModule, TrackingModule, TripsModule, DeliveryModule, PaymentsModule, AdminModule, SupportModule, AnalyticsModule],
  controllers: [HealthController, BootstrapController],
})
export class AppModule {}
