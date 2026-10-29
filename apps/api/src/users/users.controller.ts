import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards';
import { UpdateProfileDto } from '../auth/dto';
import { STORE } from '../data/store.interface';
import { Inject } from '@nestjs/common';
import type { Store } from '../data/store.interface';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    @Inject(STORE) private readonly store: Store,
  ) {}

  @Get('me') async me(@Req() req: any) {
    return { data: await this.auth.getMe(req.user.id) };
  }
  @Patch('me') async updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    await this.store.updateUserProfile(req.user.id, dto.firstName, dto.lastName);
    return { data: await this.auth.getMe(req.user.id) };
  }
}
