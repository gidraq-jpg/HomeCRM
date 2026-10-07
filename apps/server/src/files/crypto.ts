import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const Envelope = z.strictObject({
  version: z.number().int().positive(),
  wrappedKey: z.string(),
  iv: z.string(),
  tag: z.string(),
});
export type Envelope = z.infer<typeof Envelope>;
function encrypt(key: Buffer, data: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const dataOut = Buffer.concat([cipher.update(data), cipher.final()]);
  return { data: dataOut, iv, tag: cipher.getAuthTag() };
}
function decrypt(key: Buffer, data: Buffer, iv: Buffer, tag: Buffer, context: string) {
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
export class FileCipher {
  private key: Buffer;
  readonly version: number;
  constructor(key: Buffer, version: number) {
    if (key.length !== 32 || !Number.isSafeInteger(version) || version < 1)
      throw new Error('Invalid file master key');
    this.key = Buffer.from(key);
    this.version = version;
  }
  seal(data: Buffer, storageKey: string) {
    const key = randomBytes(32);
    const block = encrypt(key, data, storageKey);
    const wrapped = encrypt(this.key, key, `${this.version}:${storageKey}`);
    key.fill(0);
    return {
      block: Buffer.concat([block.iv, block.tag, block.data]),
      envelope: {
        version: this.version,
        wrappedKey: wrapped.data.toString('base64'),
        iv: wrapped.iv.toString('base64'),
        tag: wrapped.tag.toString('base64'),
      },
    };
  }
  open(block: Buffer, input: unknown, storageKey: string): Buffer {
    const envelope = Envelope.parse(input);
    if (envelope.version !== this.version || block.length < 28)
      throw new Error('File key version unavailable');
    const key = decrypt(
      this.key,
      Buffer.from(envelope.wrappedKey, 'base64'),
      Buffer.from(envelope.iv, 'base64'),
      Buffer.from(envelope.tag, 'base64'),
      `${envelope.version}:${storageKey}`,
    );
    try {
      return decrypt(
        key,
        block.subarray(28),
        block.subarray(0, 12),
        block.subarray(12, 28),
        storageKey,
      );
    } finally {
      key.fill(0);
    }
  }
}
export async function readMasterKey(path: string, version: number): Promise<FileCipher> {
  try {
    const text = (await readFile(path, 'utf8')).trim();
    if (!/^[a-fA-F0-9]{64}$/.test(text)) throw new Error('format');
    return new FileCipher(Buffer.from(text, 'hex'), version);
  } catch {
    throw new Error('File encryption master key is missing, unreadable or invalid');
  }
}
