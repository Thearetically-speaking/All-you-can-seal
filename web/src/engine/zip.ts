/**
 * Minimal zip reader/writer that keeps untouched entries' compressed bytes
 * verbatim (FR-7: everything except the rewritten plates is preserved
 * byte-for-byte). fflate is only used to inflate/deflate the entries we
 * actually read or replace.
 */
import { deflateSync, inflateSync } from 'fflate';

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Raw (still-compressed) entry data. */
  raw: Uint8Array;
  /** DOS mod time/date copied through so timestamps survive a repack. */
  modTime: number;
  modDate: number;
  externalAttrs: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function readZip(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find end-of-central-directory record (scan backwards past any comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not-a-zip');

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== SIG_CENTRAL) throw new Error('bad-central-directory');
    const method = view.getUint16(off + 10, true);
    const modTime = view.getUint16(off + 12, true);
    const modDate = view.getUint16(off + 14, true);
    const crc = view.getUint32(off + 16, true);
    const compressedSize = view.getUint32(off + 20, true);
    const uncompressedSize = view.getUint32(off + 24, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const externalAttrs = view.getUint32(off + 38, true);
    const localOff = view.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));

    if (view.getUint32(localOff, true) !== SIG_LOCAL) throw new Error('bad-local-header');
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    entries.push({ name, method, crc32: crc, compressedSize, uncompressedSize, raw, modTime, modDate, externalAttrs });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function entryData(entry: ZipEntry): Uint8Array {
  if (entry.method === 0) return entry.raw;
  if (entry.method === 8) return inflateSync(entry.raw);
  throw new Error(`unsupported-compression-${entry.method}`);
}

/** Replace an entry's content (deflate-compressed) in place. */
export function setEntryData(entry: ZipEntry, data: Uint8Array): void {
  entry.raw = deflateSync(data, { level: 6 });
  entry.method = 8;
  entry.crc32 = crc32(data);
  entry.compressedSize = entry.raw.length;
  entry.uncompressedSize = data.length;
}

export function makeEntry(name: string, data: Uint8Array, like?: ZipEntry): ZipEntry {
  const e: ZipEntry = {
    name,
    method: 8,
    crc32: 0,
    compressedSize: 0,
    uncompressedSize: 0,
    raw: new Uint8Array(0),
    modTime: like?.modTime ?? 0,
    modDate: like?.modDate ?? 0x2100, // 1996-08-00, arbitrary fixed date
    externalAttrs: like?.externalAttrs ?? 0,
  };
  setEntryData(e, data);
  return e;
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  let size = 22; // EOCD
  for (let i = 0; i < entries.length; i++) {
    size += 30 + names[i].length + entries[i].raw.length; // local
    size += 46 + names[i].length; // central
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let off = 0;
  const localOffsets: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    localOffsets.push(off);
    view.setUint32(off, SIG_LOCAL, true);
    view.setUint16(off + 4, 20, true); // version needed
    view.setUint16(off + 6, 0, true); // flags
    view.setUint16(off + 8, e.method, true);
    view.setUint16(off + 10, e.modTime, true);
    view.setUint16(off + 12, e.modDate, true);
    view.setUint32(off + 14, e.crc32, true);
    view.setUint32(off + 18, e.compressedSize, true);
    view.setUint32(off + 22, e.uncompressedSize, true);
    view.setUint16(off + 26, names[i].length, true);
    view.setUint16(off + 28, 0, true); // extra len
    out.set(names[i], off + 30);
    out.set(e.raw, off + 30 + names[i].length);
    off += 30 + names[i].length + e.raw.length;
  }

  const centralStart = off;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    view.setUint32(off, SIG_CENTRAL, true);
    view.setUint16(off + 4, 20, true); // version made by
    view.setUint16(off + 6, 20, true); // version needed
    view.setUint16(off + 8, 0, true); // flags
    view.setUint16(off + 10, e.method, true);
    view.setUint16(off + 12, e.modTime, true);
    view.setUint16(off + 14, e.modDate, true);
    view.setUint32(off + 16, e.crc32, true);
    view.setUint32(off + 20, e.compressedSize, true);
    view.setUint32(off + 24, e.uncompressedSize, true);
    view.setUint16(off + 28, names[i].length, true);
    view.setUint16(off + 30, 0, true); // extra
    view.setUint16(off + 32, 0, true); // comment
    view.setUint16(off + 34, 0, true); // disk
    view.setUint16(off + 36, 0, true); // internal attrs
    view.setUint32(off + 38, e.externalAttrs, true);
    view.setUint32(off + 42, localOffsets[i], true);
    out.set(names[i], off + 46);
    off += 46 + names[i].length;
  }

  view.setUint32(off, SIG_EOCD, true);
  view.setUint16(off + 4, 0, true);
  view.setUint16(off + 6, 0, true);
  view.setUint16(off + 8, entries.length, true);
  view.setUint16(off + 10, entries.length, true);
  view.setUint32(off + 12, off - centralStart, true);
  view.setUint32(off + 16, centralStart, true);
  view.setUint16(off + 20, 0, true);
  return out;
}
