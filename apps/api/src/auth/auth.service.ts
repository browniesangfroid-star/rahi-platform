import { createHash, randomBytes, randomInt } from 'crypto';
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { STORE } from '../data/store.interface';
import type { Store } from '../data/store.interface';
import { ALL_PERMISSIONS } from './permissions';
import { SMS_PROVIDER } from './sms.provider';
import type { SmsProvider } from './sms.provider';
import { OTP_RATE_LIMITER } from './otp-rate-limiter';
import { EncryptionService } from '../crypto/encryption.service';

export interface TokenPair { accessToken: string; refreshToken: string; }
export interface PublicUser {
  id: string; phone: string | null; email: string | null;
  firstName: string; lastName: string; roles: string[]; permissions: string[];
}

function hashRefresh(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    private readonly jwt: JwtService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(OTP_RATE_LIMITER) private readonly rateLimiter: { allow(key: string): Promise<boolean> },
    private readonly crypto: EncryptionService,
  ) {}

  private async publicUser(userId: string): Promise<PublicUser> {
    const user = await this.store.getUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    const roles = await this.store.getRolesForUser(userId);
    const roleNames = roles.map((r) => r.name);
    const permissions = roleNames.includes('SUPER_ADMIN')
      ? [...ALL_PERMISSIONS]
      : await this.store.getPermissionsForUser(userId);
    return {
      id: user.id, phone: user.phone, email: user.email,
      firstName: user.firstName, lastName: user.lastName,
      roles: roleNames, permissions,
    };
  }

  async getMe(userId: string) { return this.publicUser(userId); }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const me = await this.publicUser(userId);
    const accessToken = this.jwt.sign(
      { sub: userId, type: 'access', roles: me.roles, permissions: me.permissions },
      { expiresIn: '15m' },
    );
    const refreshToken = randomBytes(48).toString('hex');
    await this.store.createSession(userId, hashRefresh(refreshToken), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    return { accessToken, refreshToken };
  }

  async requestOtp(phone: string): Promise<{ sent: boolean }> {
    if (!(await this.rateLimiter.allow(`otp:${phone}`))) {
      throw new HttpException('Too many OTP requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    let user = await this.store.getUserByPhone(phone);
    if (!user) user = await this.store.createPhoneUser(phone);
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    const code = String(randomInt(100000, 1000000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    await this.store.createOtp(phone, codeHash, new Date(Date.now() + 5 * 60 * 1000));
    await this.sms.sendOtp(phone, code);
    return { sent: true };
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair & { user: PublicUser }> {
    const otp = await this.store.getLatestOtp(phone);
    if (!otp) throw new UnauthorizedException('Invalid or expired OTP');
    if (otp.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('OTP expired');
    if (otp.attempts >= 5) throw new UnauthorizedException('OTP attempts exceeded');
    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) {
      await this.store.incrementOtpAttempts(otp.id);
      throw new UnauthorizedException('Invalid OTP');
    }
    await this.store.consumeOtp(otp.id);
    const user = await this.store.getUserByPhone(phone);
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    await this.store.markPhoneVerified(user.id);
    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.publicUser(user.id) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const session = await this.store.getSessionByHash(hashRefresh(refreshToken));
    if (!session) throw new UnauthorizedException('Invalid refresh token');
    if (session.revokedAt) {
      // Reuse of a revoked token = possible theft: revoke the whole family.
      await this.store.revokeAllSessions(session.userId);
      throw new UnauthorizedException('Refresh token revoked');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await this.store.revokeSession(session.id);
      throw new UnauthorizedException('Refresh token expired');
    }
    await this.store.revokeSession(session.id);
    return this.issueTokens(session.userId);
  }

  async logout(refreshToken: string): Promise<{ ok: boolean }> {
    const session = await this.store.getSessionByHash(hashRefresh(refreshToken));
    if (session) await this.store.revokeSession(session.id);
    return { ok: true };
  }

  async logoutAll(userId: string): Promise<{ ok: boolean }> {
    await this.store.revokeAllSessions(userId);
    return { ok: true };
  }

  async adminLogin(email: string, password: string): Promise<TokenPair | { mfaRequired: true; mfaToken: string }> {
    const user = await this.store.getUserByEmail(email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.mfaEnabled) {
      const mfaToken = this.jwt.sign({ sub: user.id, type: 'mfa' }, { expiresIn: '5m' });
      return { mfaRequired: true, mfaToken };
    }
    return this.issueTokens(user.id);
  }

  async verifyMfa(mfaToken: string, code: string): Promise<TokenPair> {
    let payload: any;
    try {
      payload = this.jwt.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid MFA token');
    }
    if (payload.type !== 'mfa') throw new UnauthorizedException('Invalid MFA token');
    const user = await this.store.getUserById(payload.sub);
    if (!user || !user.mfaSecret) throw new UnauthorizedException('MFA not configured');
    const ok = authenticator.verify({ token: code, secret: this.crypto.decryptMaybe(user.mfaSecret) ?? '' });
    if (!ok) throw new UnauthorizedException('Invalid MFA code');
    return this.issueTokens(user.id);
  }

  async setupMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    const user = await this.store.getUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    await this.store.setMfa(userId, this.crypto.encrypt(secret), false);
    const label = user.email ?? user.phone ?? userId;
    return { secret, otpauthUrl: authenticator.keyuri(label, 'Rahi', secret) };
  }

  async enableMfa(userId: string, code: string): Promise<{ enabled: boolean }> {
    const user = await this.store.getUserById(userId);
    if (!user || !user.mfaSecret) throw new UnauthorizedException('MFA not configured');
    const ok = authenticator.verify({ token: code, secret: this.crypto.decryptMaybe(user.mfaSecret) ?? '' });
    if (!ok) throw new UnauthorizedException('Invalid MFA code');
    // Re-encrypt on enable so a legacy plaintext secret migrates to v1 ciphertext.
    await this.store.setMfa(userId, this.crypto.encrypt(this.crypto.decryptMaybe(user.mfaSecret) ?? ''), true);
    return { enabled: true };
  }
}
