import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { DriversService } from './drivers.service';
import { ReasonDto } from './dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminKycController {
  constructor(private readonly drivers: DriversService) {}

  @Get('kyc') @RequirePermissions('drivers.approve') async queue(@Query('status') status?: string) {
    return { data: await this.drivers.listQueue(status ?? 'SUBMITTED') };
  }

  @Get('drivers/:userId/status') @RequirePermissions('drivers.approve') async driverStatus(@Param('userId') userId: string) {
    return { data: await this.drivers.getStatus(userId) };
  }
  @Post('drivers/:userId/start-review') @RequirePermissions('drivers.approve') async startReview(@Param('userId') userId: string, @Req() req: any) {
    return { data: await this.drivers.startReview(userId, req.user.id) };
  }
  @Post('drivers/:userId/approve') @RequirePermissions('drivers.approve') async approve(@Param('userId') userId: string, @Req() req: any) {
    return { data: await this.drivers.approve(userId, req.user.id) };
  }
  @Post('drivers/:userId/reject') @RequirePermissions('drivers.reject') async reject(@Param('userId') userId: string, @Req() req: any, @Body() dto: ReasonDto) {
    return { data: await this.drivers.reject(userId, req.user.id, dto.reason) };
  }
  @Post('drivers/:userId/request-changes') @RequirePermissions('drivers.approve') async requestChanges(@Param('userId') userId: string, @Req() req: any, @Body() dto: ReasonDto) {
    return { data: await this.drivers.requestChanges(userId, req.user.id, dto.reason) };
  }
  @Post('drivers/:userId/suspend') @RequirePermissions('users.suspend') async suspend(@Param('userId') userId: string, @Req() req: any, @Body() dto: ReasonDto) {
    return { data: await this.drivers.suspend(userId, req.user.id, dto.reason) };
  }
  @Post('drivers/:userId/reinstate') @RequirePermissions('users.suspend') async reinstate(@Param('userId') userId: string, @Req() req: any) {
    return { data: await this.drivers.reinstate(userId, req.user.id) };
  }
  @Post('vehicles/:vehicleId/approve') @RequirePermissions('drivers.approve') async approveVehicle(@Param('vehicleId') vehicleId: string) {
    return { data: await this.drivers.approveVehicle(vehicleId) };
  }
}
