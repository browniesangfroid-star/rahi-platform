import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { StorageProvider } from './storage.provider';

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

type S3ClientLike = {
  send(command: unknown): Promise<unknown>;
};

/**
 * S3-compatible provider (AWS S3, MinIO, or any S3 API). The bucket
 * stays private: objects are fetched with server credentials and
 * returned through the API, never via a public or presigned URL.
 * MinIO needs an endpoint + forcePathStyle; AWS needs neither.
 * The client is injectable so tests can substitute a stub.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3ClientLike;

  constructor(
    private readonly config: S3StorageConfig,
    client?: S3ClientLike,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: buffer, ContentType: mimeType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const output = (await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )) as { Body?: unknown };
    const body = output.Body;
    if (body === undefined || body === null) throw new Error(`S3 object not found: ${key}`);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    // Streaming body (real SDK): collect chunks.
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}
