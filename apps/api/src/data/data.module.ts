import { Global, Module } from '@nestjs/common';
import { STORE } from './store.interface';
import { InMemoryStore } from './in-memory.store';
import { PostgresStore } from './postgres.store';
import { SMS_PROVIDER, LogSmsProvider } from '../auth/sms.provider';
import { TwilioSmsProvider } from '../auth/twilio-sms.provider';
import { OtpRateLimiter, OTP_RATE_LIMITER } from '../auth/otp-rate-limiter';
import { RedisOtpRateLimiter } from '../auth/redis-otp-rate-limiter';
import { EncryptionService } from '../crypto/encryption.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { S3StorageProvider } from '../storage/s3-storage.provider';
import * as path from 'path';
import { LOCATION_INDEX } from '../dispatch/location-index';
import { InMemoryLocationIndex } from '../dispatch/in-memory-location-index';
import { RedisLocationIndex } from '../dispatch/redis-location-index';

@Global()
@Module({
  providers: [
    {
      provide: STORE,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (url) return new PostgresStore(url);
        // eslint-disable-next-line no-console
        console.warn('[data] DATABASE_URL not set — using in-memory store (DEV ONLY, data lost on restart). Set DATABASE_URL for Postgres.');
        return new InMemoryStore();
      },
    },
    {
      provide: SMS_PROVIDER,
      useFactory: () => {
        const selected = (process.env.SMS_PROVIDER ?? 'log').toLowerCase();
        if (selected === 'twilio') {
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const from = process.env.TWILIO_FROM_NUMBER;
          if (!accountSid || !authToken || !from) {
            throw new Error('SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER');
          }
          return new TwilioSmsProvider({
            accountSid, authToken, from, brand: process.env.SMS_BRAND_NAME,
          });
        }
        if (selected !== 'log') {
          throw new Error(`Unknown SMS_PROVIDER: ${selected} (supported: log, twilio)`);
        }
        // eslint-disable-next-line no-console
        console.warn('[sms] No SMS vendor configured — OTP codes are logged, not delivered. Set SMS_PROVIDER=twilio for real delivery.');
        return new LogSmsProvider();
      },
    },
    EncryptionService,
    {
      provide: STORAGE_PROVIDER,
      useFactory: () => {
        const bucket = process.env.S3_BUCKET;
        if (bucket) {
          const accessKeyId = process.env.S3_ACCESS_KEY_ID;
          const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
          if (!accessKeyId || !secretAccessKey) {
            throw new Error('S3_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing');
          }
          return new S3StorageProvider({
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION ?? 'us-east-1',
            bucket,
            accessKeyId,
            secretAccessKey,
            // MinIO (custom endpoint) needs path-style addressing.
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || !!process.env.S3_ENDPOINT,
          });
        }
        // eslint-disable-next-line no-console
        console.warn('[data] S3_BUCKET not set — using local-disk document storage (DEV ONLY). Set S3_BUCKET for S3/MinIO.');
        return new LocalStorageProvider(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'uploads'));
      },
    },
    {
      provide: OTP_RATE_LIMITER,
      useFactory: () => {
        const url = process.env.REDIS_URL;
        if (url) return new RedisOtpRateLimiter(url);
        // eslint-disable-next-line no-console
        console.warn('[data] REDIS_URL not set — using in-memory OTP rate limiter (DEV ONLY). Set REDIS_URL for shared limiting.');
        return new OtpRateLimiter();
      },
    },
    {
      provide: LOCATION_INDEX,
      useFactory: () => {
        const url = process.env.REDIS_URL;
        if (url) return new RedisLocationIndex(url);
        // eslint-disable-next-line no-console
        console.warn('[data] REDIS_URL not set — using in-memory location index (DEV ONLY). Set REDIS_URL for Redis GEO.');
        return new InMemoryLocationIndex();
      },
    },
  ],
  exports: [STORE, SMS_PROVIDER, OTP_RATE_LIMITER, LOCATION_INDEX, EncryptionService, STORAGE_PROVIDER],
})
export class DataModule {}
