/**
 * Lightweight G-code motion parser for the 3D preview (FR-5).
 * Parses G0/G1/G2/G3 in the body section into flat typed arrays so the UI can
 * hand them straight to a THREE.BufferGeometry (and transfer them out of a
 * Web Worker without copying).
 */
import { splitKeepEnds, parseBoundaries } from './rewrite';

export interface LayerInfo {
  z: number;
  /** First segment index of the layer (inclusive). */
  start: number;
  /** One past the last segment index. */
  end: number;
}

export interface Toolpath {
  count: number;
  /** count*6 floats: x0 y0 z0 x1 y1 z1 per segment. */
  positions: Float32Array;
  /** Feedrate in mm/min per segment. */
  feeds: Float32Array;
  /** 1 = extruding (seal line), 0 = travel. */
  extrude: Uint8Array;
  /** Layer index per segment. */
  layerOf: Uint32Array;
  /** Source line number (1-based, within the whole file) per segment. */
  lineNo: Uint32Array;
  /** prefix[i] = number of seal segments among segments [0, i). Length count+1. */
  sealPrefix: Uint32Array;
  travelPrefix: Uint32Array;
  layers: LayerInfo[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number };
  /** Total extruding path length, mm. */
  sealLength: number;
  travelLength: number;
  /** Estimated body duration: sum of length/feedrate (FR: show estimated seal time). */
  estSeconds: number;
  maxFeed: number;
  minFeed: number;
}

class F32 {
  arr = new Float32Array(4096);
  len = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.len + 6 > this.arr.length) this.grow();
    const A = this.arr;
    let i = this.len;
    A[i++] = a; A[i++] = b; A[i++] = c; A[i++] = d; A[i++] = e; A[i++] = f;
    this.len = i;
  }
  push(v: number) {
    if (this.len + 1 > this.arr.length) this.grow();
    this.arr[this.len++] = v;
  }
  private grow() {
    const next = new Float32Array(this.arr.length * 2);
    next.set(this.arr);
    this.arr = next;
  }
  done(): Float32Array {
    return this.arr.slice(0, this.len);
  }
}

export function parseToolpath(text: string): Toolpath {
  const lines = splitKeepEnds(text);
  const b = parseBoundaries(lines);
  const start = b.machineStart !== null ? b.machineStart + 1 : 0;
  const end = b.machineEnd !== null ? b.machineEnd : lines.length;

  const positions = new F32();
  const feeds = new F32();
  const extrudeArr: number[] = [];
  const layerArr: number[] = [];
  const lineArr: number[] = [];
  const layers: LayerInfo[] = [];

  let x = 0, y = 0, z = 0, f = 0;
  let absolute = true;
  let absoluteE = false;
  let e = 0;
  let layerIdx = -1;
  let segCount = 0;
  let sealLength = 0, travelLength = 0, estSeconds = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let maxFeed = 0, minFeed = Infinity;

  const beginLayer = (zh: number) => {
    if (layers.length > 0) layers[layers.length - 1].end = segCount;
    layers.push({ z: zh, start: segCount, end: segCount });
    layerIdx = layers.length - 1;
  };

  const emit = (x1: number, y1: number, z1: number, extruding: boolean, srcLine: number) => {
    const dx = x1 - x, dy = y1 - y, dz = z1 - z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return;
    if (layerIdx === -1) beginLayer(z1);
    positions.push6(x, y, z, x1, y1, z1);
    feeds.push(f);
    extrudeArr.push(extruding ? 1 : 0);
    layerArr.push(layerIdx);
    lineArr.push(srcLine + 1);
    segCount++;
    if (extruding) sealLength += len; else travelLength += len;
    if (f > 0) estSeconds += len / (f / 60);
    if (f > maxFeed) maxFeed = f;
    if (f > 0 && f < minFeed) minFeed = f;
    if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
    if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z1 > maxZ) maxZ = z1;
  };

  for (let i = start; i < end; i++) {
    const raw = lines[i];
    let line = raw;
    const semi = line.indexOf(';');
    if (semi === 0 || (semi > 0 && line.slice(0, semi).trim() === '')) {
      // Pure comment — look for layer markers.
      const m = raw.match(/^;\s*Z_HEIGHT:\s*(-?\d+(?:\.\d+)?)/);
      if (raw.includes('; CHANGE_LAYER') || raw.includes(';LAYER_CHANGE')) {
        beginLayer(z);
      } else if (m && layers.length > 0) {
        layers[layers.length - 1].z = parseFloat(m[1]);
      }
      continue;
    }
    if (semi >= 0) line = line.slice(0, semi);
    line = line.trim();
    if (line === '') continue;
    const c0 = line.charCodeAt(0);
    if (c0 !== 71 && c0 !== 77) continue; // G or M

    const words = line.split(/\s+/);
    const cmd = words[0].toUpperCase();

    if (cmd === 'G90') { absolute = true; continue; }
    if (cmd === 'G91') { absolute = false; continue; }
    if (cmd === 'M82') { absoluteE = true; continue; }
    if (cmd === 'M83') { absoluteE = false; continue; }
    if (cmd === 'G92') {
      for (let w = 1; w < words.length; w++) {
        const k = words[w][0].toUpperCase();
        const v = parseFloat(words[w].slice(1));
        if (Number.isNaN(v)) continue;
        if (k === 'E') e = v;
        else if (k === 'X') x = v;
        else if (k === 'Y') y = v;
        else if (k === 'Z') z = v;
      }
      continue;
    }

    const isLinear = cmd === 'G0' || cmd === 'G1';
    const isArc = cmd === 'G2' || cmd === 'G3';
    if (!isLinear && !isArc) continue;

    let nx = NaN, ny = NaN, nz = NaN, ne = NaN, nf = NaN, ci = 0, cj = 0;
    for (let w = 1; w < words.length; w++) {
      const word = words[w];
      const k = word.charCodeAt(0);
      const v = parseFloat(word.slice(1));
      if (Number.isNaN(v)) continue;
      switch (k) {
        case 88: case 120: nx = v; break; // X
        case 89: case 121: ny = v; break; // Y
        case 90: case 122: nz = v; break; // Z
        case 69: case 101: ne = v; break; // E
        case 70: case 102: nf = v; break; // F
        case 73: case 105: ci = v; break; // I
        case 74: case 106: cj = v; break; // J
      }
    }
    if (!Number.isNaN(nf)) f = nf;

    const tx = Number.isNaN(nx) ? x : absolute ? nx : x + nx;
    const ty = Number.isNaN(ny) ? y : absolute ? ny : y + ny;
    const tz = Number.isNaN(nz) ? z : absolute ? nz : z + nz;
    let eDelta = 0;
    if (!Number.isNaN(ne)) {
      eDelta = absoluteE ? ne - e : ne;
      e = absoluteE ? ne : e + ne;
    }
    const extruding = eDelta > 0;

    if (isLinear) {
      emit(tx, ty, tz, extruding, i);
      x = tx; y = ty; z = tz;
    } else {
      // G2 (CW) / G3 (CCW) arc with I/J center offset, tessellated.
      const cx = x + ci, cy = y + cj;
      const r = Math.sqrt(ci * ci + cj * cj);
      if (r === 0) { emit(tx, ty, tz, extruding, i); x = tx; y = ty; z = tz; continue; }
      const a0 = Math.atan2(y - cy, x - cx);
      let a1 = Math.atan2(ty - cy, tx - cx);
      const cw = cmd === 'G2';
      let sweep = a1 - a0;
      if (cw && sweep >= -1e-9) sweep -= 2 * Math.PI;
      if (!cw && sweep <= 1e-9) sweep += 2 * Math.PI;
      const steps = Math.min(64, Math.max(2, Math.ceil(Math.abs(sweep) * r / 0.5)));
      for (let s = 1; s <= steps; s++) {
        const a = a0 + (sweep * s) / steps;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        const pz = z + ((tz - z) * s) / steps;
        emit(px, py, pz, extruding, i);
        x = px; y = py; z = pz;
      }
      x = tx; y = ty; z = tz;
    }
  }
  if (layers.length > 0) layers[layers.length - 1].end = segCount;

  const extrude = Uint8Array.from(extrudeArr);
  const sealPrefix = new Uint32Array(segCount + 1);
  const travelPrefix = new Uint32Array(segCount + 1);
  for (let i = 0; i < segCount; i++) {
    sealPrefix[i + 1] = sealPrefix[i] + (extrude[i] ? 1 : 0);
    travelPrefix[i + 1] = travelPrefix[i] + (extrude[i] ? 0 : 1);
  }

  return {
    count: segCount,
    positions: positions.done(),
    feeds: feeds.done(),
    extrude,
    layerOf: Uint32Array.from(layerArr),
    lineNo: Uint32Array.from(lineArr),
    sealPrefix,
    travelPrefix,
    layers,
    bbox: {
      minX: minX === Infinity ? 0 : minX,
      minY: minY === Infinity ? 0 : minY,
      maxX: maxX === -Infinity ? 0 : maxX,
      maxY: maxY === -Infinity ? 0 : maxY,
      maxZ: maxZ === -Infinity ? 0 : maxZ,
    },
    sealLength,
    travelLength,
    estSeconds,
    maxFeed,
    minFeed: minFeed === Infinity ? 0 : minFeed,
  };
}
