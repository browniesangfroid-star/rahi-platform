import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../auth/guards';
import { AssignRoleDto, CreateRoleDto } from '../auth/dto';
import { STORE } from '../data/store.interface';
import { Inject, NotFoundException } from '@nestjs/common';
import type { Store } from '../data/store.interface';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RbacController {
  constructor(@Inject(STORE) private readonly store: Store) {}

  @Get('roles') @RequirePermissions('roles.manage') async listRoles() {
    return { data: await this.store.listRoles() };
  }
  @Post('roles') @RequirePermissions('roles.manage') async createRole(@Body() dto: CreateRoleDto) {
    const role = await this.store.createRole(dto.name);
    for (const p of dto.permissionNames ?? []) {
      await this.store.addPermissionToRole(role.id, p);
    }
    const roles = await this.store.listRoles();
    return { data: roles.find((r) => r.id === role.id) };
  }
  @Post('users/:userId/roles') @RequirePermissions('admins.manage') async assignRole(
    @Param('userId') userId: string, @Body() dto: AssignRoleDto,
  ) {
    const roles = await this.store.listRoles();
    const role = roles.find((r) => r.name === dto.roleName);
    if (!role) throw new NotFoundException('Role not found');
    await this.store.assignRoleToUser(userId, role.id);
    return { data: { userId, roleName: role.name } };
  }
}
