import { promises as fs } from 'fs';
import * as path from 'path';
import type { StorageProvider } from './storage.provider';

/**
 * Local-disk provider (dev only). Keys are flattened (`a/b` ->
 * `a_b`) exactly as the Phase 5 implementation did, so files
 * written before Phase 17 remain readable after the switch.
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  private filePath(key: string): string {
    return path.join(this.rootDir, key.replace(/\//g, '_'));
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(this.filePath(key), buffer);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.filePath(key));
  }
}
