import { Module } from '@nestjs/common';
import { TripsController, TripsAdminController } from './trips.controller';
import { TripsService } from './trips.service';
import { AuthModule } from '../auth/auth.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AuthModule, TrackingModule, DeliveryModule, PaymentsModule],
  controllers: [TripsController, TripsAdminController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
