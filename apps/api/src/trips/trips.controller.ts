import { Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { TripsService } from './trips.service';
import { CancelTripDto, VerifyOtpDto, VerifyPinDto } from './dto';

function isAdmin(req: any): boolean {
  return req.user.roles?.includes('SUPER_ADMIN') || req.user.permissions?.includes('rides.read');
}

/** Trip endpoints live under /trips, not /rides, so they can never
 *  collide with the pre-match request endpoints in RidesController
 *  (which also has a POST /rides/:id/cancel, for unmatched requests). */
@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get(':rideId') async get(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.getTrip(rideId, req.user.id, isAdmin(req)) };
  }

  @Post(':rideId/en-route') async enRoute(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.enRoute(req.user.id, rideId) };
  }

  @Post(':rideId/arrived') async arrived(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.arrived(req.user.id, rideId) };
  }

  @Post(':rideId/begin-pin-verification') async beginPin(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.beginPinVerification(req.user.id, rideId) };
  }

  @Post(':rideId/verify-pin') async verifyPin(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: VerifyPinDto,
  ) {
    return { data: await this.trips.verifyPin(req.user.id, rideId, dto.pin) };
  }

  @Post(':rideId/regenerate-pin') async regeneratePin(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.regeneratePin(req.user.id, rideId) };
  }

  @Post(':rideId/complete') async complete(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.complete(req.user.id, rideId) };
  }

  @Post(':rideId/cancel') async cancelCustomer(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: CancelTripDto,
  ) {
    return { data: await this.trips.cancel(req.user.id, rideId, 'CUSTOMER', dto.reason ?? null) };
  }

  @Post(':rideId/driver-cancel') async cancelDriver(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: CancelTripDto,
  ) {
    return { data: await this.trips.cancel(req.user.id, rideId, 'DRIVER', dto.reason ?? null) };
  }

  @Post(':rideId/no-show') async noShow(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.noShow(req.user.id, rideId) };
  }

  // ---- Delivery (Phase 11) ----
  @Get(':rideId/delivery') async getDelivery(@Req() req: any, @Param('rideId') rideId: string) {
    return { data: await this.trips.getDelivery(rideId, req.user.id, isAdmin(req)) };
  }

  @Post(':rideId/delivery/arrived-at-recipient') async arrivedAtRecipient(
    @Req() req: any, @Param('rideId') rideId: string,
  ) {
    return { data: await this.trips.arrivedAtRecipient(req.user.id, rideId) };
  }

  @Post(':rideId/delivery/verify-otp') async verifyDeliveryOtp(
    @Req() req: any, @Param('rideId') rideId: string, @Body() dto: VerifyOtpDto,
  ) {
    return { data: await this.trips.verifyDeliveryOtp(req.user.id, rideId, dto.otp) };
  }

  @Post(':rideId/delivery/regenerate-otp') async regenerateDeliveryOtp(
    @Req() req: any, @Param('rideId') rideId: string,
  ) {
    return { data: await this.trips.regenerateDeliveryOtp(req.user.id, rideId) };
  }

  @Post(':rideId/delivery/photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadDeliveryPhoto(
    @Req() req: any, @Param('rideId') rideId: string, @UploadedFile() file: any,
  ) {
    if (!file) throw new Error('A photo file is required');
    return {
      data: await this.trips.addDeliveryPhoto(req.user.id, rideId, {
        buffer: file.buffer, mimeType: file.mimetype, originalName: file.originalname,
      }),
    };
  }

  @Get(':rideId/delivery/photos/:proofId') async downloadDeliveryPhoto(
    @Req() req: any, @Param('rideId') rideId: string, @Param('proofId') proofId: string, @Res() res: Response,
  ) {
    const { path: filePath } = await this.trips.downloadDeliveryPhoto(rideId, proofId, req.user.id, isAdmin(req));
    createReadStream(filePath).pipe(res);
  }
}

@Controller('admin/trips')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TripsAdminController {
  constructor(private readonly trips: TripsService) {}

  @Post(':rideId/cancel')
  @RequirePermissions('rides.cancel')
  async cancelAdmin(@Req() req: any, @Param('rideId') rideId: string, @Body() dto: CancelTripDto) {
    return { data: await this.trips.cancel(req.user.id, rideId, 'ADMIN', dto.reason ?? null) };
  }
}
