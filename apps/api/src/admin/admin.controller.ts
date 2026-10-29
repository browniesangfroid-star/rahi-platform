import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { AdminService } from './admin.service';
import { CreateCityDto, CreatePricingRuleDto, SetCityActiveDto, SetPackageCategoriesDto, SetServiceCategoriesDto, UpdateCatalogDto } from './dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @RequirePermissions('cities.manage')
  @Post('cities') async createCity(@Req() req: any, @Body() dto: CreateCityDto) {
    return { data: await this.admin.createCity(req.user.id, dto) };
  }

  @RequirePermissions('cities.manage')
  @Get('cities') async listCities() {
    return { data: await this.admin.listCities() };
  }

  @RequirePermissions('cities.manage')
  @Patch('cities/:id/active') async setCityActive(
    @Req() req: any, @Param('id') id: string, @Body() dto: SetCityActiveDto,
  ) {
    return { data: await this.admin.setCityActive(req.user.id, id, dto.isActive) };
  }

  @RequirePermissions('pricing.manage')
  @Post('pricing-rules') async createPricingRule(@Req() req: any, @Body() dto: CreatePricingRuleDto) {
    return {
      data: await this.admin.createPricingRule(req.user.id, {
        cityId: dto.cityId ?? null, serviceCode: dto.serviceCode, mode: dto.mode,
        baseFareMinor: dto.baseFareMinor, perKmMinor: dto.perKmMinor, perMinMinor: dto.perMinMinor,
        minimumFareMinor: dto.minimumFareMinor, bookingFeeMinor: dto.bookingFeeMinor, demandCap: dto.demandCap,
      }),
    };
  }

  @RequirePermissions('pricing.manage')
  @Get('pricing-rules') async listPricingRules() {
    return { data: await this.admin.listPricingRules() };
  }

  @RequirePermissions('catalog.manage')
  @Get('catalog/services') async listServices() {
    return { data: await this.admin.listServiceTypes() };
  }

  @RequirePermissions('catalog.manage')
  @Patch('catalog/services/:code') async updateService(
    @Req() req: any, @Param('code') code: string, @Body() dto: UpdateCatalogDto,
  ) {
    return { data: await this.admin.updateServiceType(req.user.id, code, dto.name, dto.isActive) };
  }

  @RequirePermissions('catalog.manage')
  @Get('catalog/vehicle-categories') async listVehicleCategories() {
    return { data: await this.admin.listVehicleCategories() };
  }

  @RequirePermissions('catalog.manage')
  @Patch('catalog/vehicle-categories/:code') async updateVehicleCategory(
    @Req() req: any, @Param('code') code: string, @Body() dto: UpdateCatalogDto,
  ) {
    return { data: await this.admin.updateVehicleCategory(req.user.id, code, dto.name, dto.isActive) };
  }

  @RequirePermissions('catalog.manage')
  @Get('catalog/service-categories') async getServiceCategories() {
    return { data: await this.admin.getServiceCategories() };
  }

  @RequirePermissions('catalog.manage')
  @Post('catalog/service-categories') async setServiceCategories(
    @Req() req: any, @Body() dto: SetServiceCategoriesDto,
  ) {
    return { data: await this.admin.setServiceCategories(req.user.id, dto.mapping) };
  }

  @RequirePermissions('catalog.manage')
  @Get('catalog/package-categories') async getPackageCategories() {
    return { data: await this.admin.getPackageCategories() };
  }

  @RequirePermissions('catalog.manage')
  @Post('catalog/package-categories') async setPackageCategories(
    @Req() req: any, @Body() dto: SetPackageCategoriesDto,
  ) {
    return { data: await this.admin.setPackageCategories(req.user.id, dto.categories) };
  }

  @RequirePermissions('audit.read')
  @Get('audit-logs') async listAuditLogs(@Query('limit') limit?: string) {
    return { data: await this.admin.listAuditLogs(limit ? Number(limit) : 100) };
  }

  @RequirePermissions('reports.read')
  @Get('overview') async getOverview() {
    return { data: await this.admin.getOverview() };
  }
}
