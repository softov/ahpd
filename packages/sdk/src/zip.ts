/**
 * A zip archive, written with what Node ships.
 *
 * The window's "collect logs" asks for one, and Node has deflate but no
 * container for it. The format is small enough to write here: a local header
 * before each entry, a central directory after them all, and one record at
 * the end saying where the directory is. Deflated, with the UTF-8 name flag
 * set, and nothing the reader in every operating system does not open.
 */

import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

/** One entry: the name it has in the archive and the file it comes from. */
export interface ZipEntry { path: string; from: string }

const TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 every zip entry carries. */
export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** A moment as the two 16-bit DOS fields the format keeps it in. */
const dosTime = (at: Date): { time: number; date: number } => {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
};

const u16 = (value: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff); return b; };
const u32 = (value: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };

/** Write the entries to `archive`, and answer the number of bytes it came to. */
export async function zip(archive: string, entries: ZipEntry[]): Promise<number> {
  const out = createWriteStream(archive);
  let offset = 0;
  const written = (chunk: Buffer): Promise<void> => new Promise((resolve, reject) => {
    offset += chunk.length;
    out.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
  const directory: Buffer[] = [];
  for (const entry of entries) {
    const data = await readFile(entry.from);
    const when = dosTime((await stat(entry.from)).mtime);
    const packed = deflateRawSync(data);
    const name = Buffer.from(entry.path.replaceAll('\\', '/'), 'utf8');
    const crc = crc32(data);
    const at = offset;
    const fields = Buffer.concat([
      u16(20), u16(0x0800), u16(8), u16(when.time), u16(when.date),
      u32(crc), u32(packed.length), u32(data.length), u16(name.length), u16(0),
    ]);
    await written(Buffer.concat([u32(0x04034b50), fields, name, packed]));
    directory.push(Buffer.concat([
      u32(0x02014b50), u16(20), fields, u16(0), u16(0), u16(0), u32(0), u32(at), name,
    ]));
  }
  const start = offset;
  for (const record of directory) await written(record);
  const size = offset - start;
  await written(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(size), u32(start), u16(0),
  ]));
  await new Promise<void>((resolve, reject) => { out.end((error?: Error | null) => (error ? reject(error) : resolve())); });
  return offset;
}
