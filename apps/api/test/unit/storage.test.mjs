import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageProvider } from '../../dist/storage/local-storage.provider.js';
import { S3StorageProvider } from '../../dist/storage/s3-storage.provider.js';

test('local storage: put/get round-trip with Phase 5 key flattening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rahi-storage-'));
  const storage = new LocalStorageProvider(dir);
  const key = 'driver-1/1234567890-CNIC.jpg';
  await storage.put(key, Buffer.from('fake-jpg-bytes'), 'image/jpeg');
  assert.equal((await storage.get(key)).toString(), 'fake-jpg-bytes');
  // Flattened on disk exactly as the old implementation wrote it.
  assert.equal((await readFile(join(dir, 'driver-1_1234567890-CNIC.jpg'))).toString(), 'fake-jpg-bytes');
});

test('s3 storage: put/get go through Put/GetObject with bucket + key', async () => {
  const seen = [];
  const objects = new Map();
  const stub = {
    async send(command) {
      seen.push(command.constructor.name);
      const input = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(`${input.Bucket}/${input.Key}`, input.Body);
        return {};
      }
      const body = objects.get(`${input.Bucket}/${input.Key}`);
      if (!body) throw new Error('NoSuchKey');
      return { Body: body };
    },
  };
  const storage = new S3StorageProvider(
    { region: 'us-east-1', bucket: 'rahi-docs', accessKeyId: 'x', secretAccessKey: 'y', forcePathStyle: true },
    stub,
  );
  await storage.put('driver-1/123-CNIC.jpg', Buffer.from('doc-bytes'), 'image/jpeg');
  assert.equal((await storage.get('driver-1/123-CNIC.jpg')).toString(), 'doc-bytes');
  assert.deepEqual(seen, ['PutObjectCommand', 'GetObjectCommand']);
  await assert.rejects(() => storage.get('driver-1/missing.jpg'), /NoSuchKey/);
});
