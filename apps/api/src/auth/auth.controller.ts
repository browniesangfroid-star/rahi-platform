import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards';
import { AdminLoginDto, MfaEnableDto, MfaVerifyDto, RefreshDto, RequestOtpDto, VerifyOtpDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request-otp') async requestOtp(@Body() dto: RequestOtpDto) {
    return { data: await this.auth.requestOtp(dto.phone) };
  }
  @Post('verify-otp') async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code);
    return { data: result };
  }
  @Post('refresh') async refresh(@Body() dto: RefreshDto) {
    return { data: await this.auth.refresh(dto.refreshToken) };
  }
  @Post('logout') async logout(@Body() dto: RefreshDto) {
    return { data: await this.auth.logout(dto.refreshToken) };
  }
  @Post('logout-all') @UseGuards(JwtAuthGuard) async logoutAll(@Req() req: any) {
    return { data: await this.auth.logoutAll(req.user.id) };
  }
  @Post('admin/login') async adminLogin(@Body() dto: AdminLoginDto) {
    return { data: await this.auth.adminLogin(dto.email, dto.password) };
  }
  @Post('admin/mfa-verify') async mfaVerify(@Body() dto: MfaVerifyDto) {
    return { data: await this.auth.verifyMfa(dto.mfaToken, dto.code) };
  }
  @Post('mfa/setup') @UseGuards(JwtAuthGuard) async setupMfa(@Req() req: any) {
    return { data: await this.auth.setupMfa(req.user.id) };
  }
  @Post('mfa/enable') @UseGuards(JwtAuthGuard) async enableMfa(@Req() req: any, @Body() dto: MfaEnableDto) {
    return { data: await this.auth.enableMfa(req.user.id, dto.code) };
  }
}
