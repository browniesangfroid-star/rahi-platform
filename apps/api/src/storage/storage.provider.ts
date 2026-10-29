/**
 * Phase 17 document storage. Driver KYC documents are private: they
 * are never served publicly and never given a public URL. Downloads
 * always go through the API (owner or drivers.approve admin), which
 * fetches the bytes with server-side credentials.
 */
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
