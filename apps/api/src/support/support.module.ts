import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController, ShareController } from './support.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [SupportService],
  controllers: [SupportController, ShareController],
  exports: [SupportService],
})
export class SupportModule {}
