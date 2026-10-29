import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { AuthModule } from '../auth/auth.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [AuthModule, TrackingModule],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
