import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Where photo bytes live. Local disk is fine for a single-VPS pilot (include it in backups);
 * implement the same interface on S3-compatible storage when running more than one replica.
 */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalBlobStore implements BlobStore {
  private root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string) {
    if (!/^[a-z0-9/_-]+\.[a-z]+$/i.test(key) || key.includes('..')) throw new Error('bad storage key');
    return join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export class MemoryBlobStore implements BlobStore {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
