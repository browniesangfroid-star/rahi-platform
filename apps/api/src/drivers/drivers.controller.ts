import { Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { DriversService } from './drivers.service';
import { OffersService } from '../offers/offers.service';
import { CreateVehicleDto, DocumentMetaDto, RegisterDriverDto, LocationDto, GoOnlineDto } from './dto';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly offers: OffersService,
  ) {}

  @Get('incoming-requests') async incomingRequests(@Req() req: any) {
    return { data: await this.offers.incomingRequests(req.user.id) };
  }

  @Post('register') async register(@Req() req: any, @Body() dto: RegisterDriverDto) {
    return { data: await this.drivers.register(req.user.id, dto.emergencyContactName ?? null, dto.emergencyContactPhone ?? null, dto.bankAccount ?? null) };
  }
  @Get('status') async status(@Req() req: any) {
    return { data: await this.drivers.getStatus(req.user.id) };
  }
  @Post('submit') async submit(@Req() req: any) {
    return { data: await this.drivers.submit(req.user.id) };
  }
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadDocument(@Req() req: any, @Body() meta: DocumentMetaDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('File is required');
    const doc = await this.drivers.addDocument({
      driverUserId: req.user.id,
      documentType: meta.documentType,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      expiresAt: meta.expiresAt ?? null,
    });
    return { data: doc };
  }
  @Get('documents/:id/file') async downloadDocument(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const isAdmin = req.user.roles?.includes('SUPER_ADMIN') || req.user.permissions?.includes('drivers.approve');
    const { doc, buffer } = await this.drivers.downloadDocument(id, req.user.id, Boolean(isAdmin));
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', 'attachment');
    res.send(buffer);
  }
  @Post('vehicles') async createVehicle(@Req() req: any, @Body() dto: CreateVehicleDto) {
    return { data: await this.drivers.createVehicle(req.user.id, dto) };
  }
  @Post('online') async goOnline(@Req() req: any, @Body() dto: GoOnlineDto) {
    return { data: await this.drivers.goOnline(req.user.id, dto.lat ?? null, dto.lng ?? null) };
  }

  @Post('offline') async goOffline(@Req() req: any) {
    return { data: await this.drivers.goOffline(req.user.id) };
  }

  @Post('location') async updateLocation(@Req() req: any, @Body() dto: LocationDto) {
    return { data: await this.drivers.updateLocation(req.user.id, dto.lat, dto.lng) };
  }

  @Post('vehicles/:id/activate') async activateVehicle(@Req() req: any, @Param('id') id: string) {
    return { data: await this.drivers.activateVehicle(req.user.id, id) };
  }
}
