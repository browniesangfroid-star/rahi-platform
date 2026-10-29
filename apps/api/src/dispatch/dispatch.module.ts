import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { DispatchAdminController } from './dispatch.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DispatchAdminController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
