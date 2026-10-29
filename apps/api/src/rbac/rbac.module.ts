import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [RbacController] })
export class RbacModule {}
