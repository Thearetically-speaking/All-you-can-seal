/**
 * .gcode.3mf handling (FR-1 / FR-2 / FR-7): enumerate plates, read their
 * G-code, and repack with updated gcode + md5 while every other entry keeps
 * its original compressed bytes.
 */
import SparkMD5 from 'spark-md5';
import { ZipEntry, entryData, makeEntry, readZip, setEntryData, writeZip } from './zip';

export interface PlateFile {
  /** Plate number N from Metadata/plate_N.gcode. */
  index: number;
  gcodePath: string;
  md5Path: string;
  text: string;
  /** PNG thumbnail bytes if the 3mf ships one. */
  thumbnail: Uint8Array | null;
}

export interface ThreeMf {
  entries: ZipEntry[];
  plates: PlateFile[];
}

const PLATE_RE = /^Metadata\/plate_(\d+)\.gcode$/i;

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('latin1').decode(data);
  }
}

export function md5HexUpper(data: Uint8Array): string {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return SparkMD5.ArrayBuffer.hash(buf).toUpperCase();
}

export function openThreeMf(buf: Uint8Array): ThreeMf {
  const entries = readZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const plates: PlateFile[] = [];
  for (const entry of entries) {
    const m = entry.name.match(PLATE_RE);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    const thumbEntry = byName.get(`Metadata/plate_${index}.png`) ?? byName.get(`Metadata/plate_${index}_small.png`);
    plates.push({
      index,
      gcodePath: entry.name,
      md5Path: `${entry.name}.md5`,
      text: decodeText(entryData(entry)),
      thumbnail: thumbEntry ? entryData(thumbEntry) : null,
    });
  }
  plates.sort((a, b) => a.index - b.index);
  if (plates.length === 0) throw new Error('no-plate-gcode');
  return { entries, plates };
}

/**
 * Rebuild the 3mf with the given plates' G-code replaced and their .md5
 * entries recomputed (fixes the legacy script's stale-md5 defect, FR-4.6).
 */
export function repackThreeMf(threeMf: ThreeMf, rewritten: Map<number, string>): Uint8Array {
  const enc = new TextEncoder();
  const entries = threeMf.entries.map((e) => ({ ...e }));
  const byName = new Map(entries.map((e) => [e.name, e]));

  for (const plate of threeMf.plates) {
    const text = rewritten.get(plate.index);
    if (text === undefined) continue;
    const data = enc.encode(text);
    const gcodeEntry = byName.get(plate.gcodePath);
    if (!gcodeEntry) throw new Error(`missing-entry-${plate.gcodePath}`);
    setEntryData(gcodeEntry, data);

    const md5Text = md5HexUpper(data);
    const md5Entry = byName.get(plate.md5Path);
    if (md5Entry) {
      setEntryData(md5Entry, enc.encode(md5Text));
    } else {
      const idx = entries.indexOf(gcodeEntry);
      entries.splice(idx + 1, 0, makeEntry(plate.md5Path, enc.encode(md5Text), gcodeEntry));
    }
  }
  return writeZip(entries);
}

/** "foo.gcode.3mf" -> "foo-sealed.gcode.3mf"; "foo.gcode" -> "foo-sealed.gcode". */
export function sealedFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gcode.3mf')) return `${name.slice(0, -'.gcode.3mf'.length)}-sealed.gcode.3mf`;
  if (lower.endsWith('.gcode')) return `${name.slice(0, -'.gcode'.length)}-sealed.gcode`;
  return `${name}-sealed`;
}
