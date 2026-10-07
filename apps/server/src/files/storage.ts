import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Только фоновая сверка: случайные ключи и время блока, без метаданных пользователя. */
  olderThan(before: Date): AsyncIterable<string>;
}
const Key = z.uuid();
export class DirectoryStorage implements FileStorage {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  private path(key: string) {
    return join(this.dir, Key.parse(key));
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.dir, { recursive: true });
    const handle = await open(this.path(key), 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async *olderThan(before: Date) {
    await mkdir(this.dir, { recursive: true });
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !Key.safeParse(entry.name).success) continue;
      try {
        if ((await stat(this.path(entry.name))).mtime < before) yield entry.name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}
