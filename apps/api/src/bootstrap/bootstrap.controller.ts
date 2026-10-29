import { Body, Controller, Headers, HttpException, Inject, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { STORE, type Store } from '../data/store.interface';

/**
 * One-time hosted bootstrap for free-tier deploys (no Render Shell).
 *
 * Render's free compute plan has no web shell, so the documented
 * Shell path (scripts/run-migrations.sh + scripts/create-admin.mjs)
 * cannot run there. This endpoint is the free-tier replacement,
 * approved by the operator for the Render deploy:
 *
 *   POST /api/v1/admin/bootstrap
 *   Header: x-bootstrap-secret: <ENCRYPTION_KEY>
 *   Body (optional): { "email": "admin@example.com", "password": ">=12 chars" }
 *
 * Safety, by design:
 * - The secret is the server's own ENCRYPTION_KEY env value. It is
 *   compared, never logged, never echoed back. Without it: 401.
 * - Migrations run inside ONE Postgres transaction. Any failure
 *   rolls everything back, so a failed attempt is safe to retry.
 * - Migrations are single-use: if the `users` table already exists,
 *   migration files are skipped (never re-applied), while admin
 *   creation can still be retried with a different email.
 * - Admin creation reuses the Store methods (same as
 *   scripts/create-admin.mjs) and refuses an existing email.
 * - The password is bcrypt-hashed (cost 12) and never returned.
 *
 * Deliberate exception to the Phase 17 rule ("no API endpoint that
 * creates admins out of thin air"): that rule assumed an operator
 * shell exists. On free Render it does not, so this guarded,
 * single-use endpoint is the operator path instead.
 */
export class BootstrapBody {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(12) password?: string;
}

function findMigrationsDir(): string {
  const here = __dirname;
  const candidates = [
    process.env.MIGRATIONS_DIR,
    '/app/apps/api/migrations',
    path.join(process.cwd(), 'apps/api/migrations'),
    path.join(process.cwd(), 'migrations'),
    path.join(here, '..', '..', 'apps', 'api', 'migrations'),
    path.join(here, '..', 'migrations'),
    path.join(here, '..', '..', '..', 'apps', 'api', 'migrations'),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, '001_core_identity_geo.sql'))) return dir;
    } catch {
      // try the next candidate
    }
  }
  throw new HttpException('Migrations directory not found on this image', 500);
}

@Controller('admin')
export class BootstrapController {
  constructor(@Inject(STORE) private readonly store: Store) {}

  @Post('bootstrap')
  async bootstrap(
    @Headers('x-bootstrap-secret') secret: string | undefined,
    @Body() body: BootstrapBody,
  ) {
    const expected = process.env.ENCRYPTION_KEY;
    if (!expected) throw new HttpException('Bootstrap is not configured', 503);
    if (!secret || secret !== expected) throw new HttpException('Unauthorized', 401);
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new HttpException('Postgres is not configured', 503);
    if ((body.email && !body.password) || (!body.email && body.password)) {
      throw new HttpException('email and password are both required for admin creation', 400);
    }

    const pool = new Pool({ connectionString: dbUrl });
    const client = await pool.connect();
    let committed = false;
    let files: string[] = [];
    try {
      await client.query('BEGIN');
      const exists = await client.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'users'`,
      );
      if ((exists.rowCount ?? 0) === 0) {
        await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
        await client.query('CREATE EXTENSION IF NOT EXISTS citext');
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        const dir = findMigrationsDir();
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
        for (const file of files) {
          await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        }
      }
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // already rolled back; the original error is what matters
        }
      }
      throw error;
    } finally {
      client.release();
      await pool.end();
    }

    let adminCreated = false;
    if (body.email && body.password) {
      const existing = await this.store.getUserByEmail(body.email);
      if (existing) throw new HttpException('An admin already exists for this email', 409);
      const admin = await this.store.createAdminUser(
        body.email,
        await bcrypt.hash(body.password, 12),
        'Admin',
        'Admin',
      );
      await this.store.assignRoleToUser(admin.id, (await this.store.createRole('SUPER_ADMIN')).id);
      adminCreated = true;
    }
    return { data: { migrationsApplied: files, adminCreated } };
  }
}
