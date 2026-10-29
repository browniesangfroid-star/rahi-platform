import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { AdminKycController } from './admin-kyc.controller';
import { DriversService } from './drivers.service';
import { AuthModule } from '../auth/auth.module';
import { OffersModule } from '../offers/offers.module';

@Module({
  imports: [AuthModule, OffersModule],
  controllers: [DriversController, AdminKycController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
