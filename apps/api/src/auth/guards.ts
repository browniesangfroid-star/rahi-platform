import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';

export const PERMISSIONS_KEY = 'permissions';
export function RequirePermissions(...permissions: string[]) {
  return (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(PERMISSIONS_KEY, permissions, descriptor ? descriptor.value : target);
    return descriptor;
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @Inject(STORE) private readonly store: Store) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing access token');
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    if (payload.type !== 'access') throw new UnauthorizedException('Invalid token type');
    const user = await this.store.getUserById(payload.sub);
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    const roles = await this.store.getRolesForUser(user.id);
    const roleNames = roles.map((r) => r.name);
    const permissions = roleNames.includes('SUPER_ADMIN')
      ? (await import('./permissions')).ALL_PERMISSIONS.slice()
      : await this.store.getPermissionsForUser(user.id);
    req.user = { id: user.id, phone: user.phone, email: user.email, roles: roleNames, permissions };
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required: string[] = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(), context.getClass(),
    ]) ?? [];
    if (required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('Not authenticated');
    if (user.roles?.includes('SUPER_ADMIN')) return true;
    const hasAll = required.every((p) => user.permissions?.includes(p));
    if (!hasAll) throw new ForbiddenException('Missing required permission');
    return true;
  }
}
