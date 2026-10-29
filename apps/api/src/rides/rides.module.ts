import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { PricingService } from './pricing.service';
import { AuthModule } from '../auth/auth.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [AuthModule, DispatchModule, TrackingModule],
  controllers: [RidesController],
  providers: [RidesService, PricingService],
  exports: [RidesService, PricingService],
})
export class RidesModule {}
