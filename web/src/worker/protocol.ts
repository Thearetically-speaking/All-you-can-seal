/** Message types between the UI and the seal worker. */
import type { CheckSummary, GcodeInfo, RewriteReport, SealParams } from '../engine/types';
import type { LayerInfo } from '../engine/toolpath';

export interface PlateMeta {
  index: number;
  info: GcodeInfo;
  gcodeBytes: number;
  /** PNG bytes, transferred. */
  thumbnail: Uint8Array | null;
}

export interface LoadResult {
  kind: '3mf' | 'gcode';
  fileName: string;
  plates: PlateMeta[];
}

/** Toolpath with typed arrays listed explicitly so they can be transferred. */
export interface ToolpathTransfer {
  count: number;
  positions: Float32Array;
  feeds: Float32Array;
  extrude: Uint8Array;
  layerOf: Uint32Array;
  lineNo: Uint32Array;
  sealPrefix: Uint32Array;
  travelPrefix: Uint32Array;
  layers: LayerInfo[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number };
  sealLength: number;
  travelLength: number;
  estSeconds: number;
  maxFeed: number;
  minFeed: number;
}

export interface PlateProcessResult {
  index: number;
  ok: boolean;
  report: RewriteReport;
  checks: CheckSummary;
}

export interface ProcessResult {
  plates: PlateProcessResult[];
  /** Toolpath of the requested preview plate (rewritten text when ok, original otherwise). */
  toolpath: ToolpathTransfer | null;
  previewPlate: number;
}

export interface ExportResult {
  fileName: string;
  bytes: Uint8Array;
}

export type WorkerRequest =
  | { id: number; type: 'load'; fileName: string; buffer: ArrayBuffer }
  | {
      id: number;
      type: 'process';
      selected: number[];
      previewPlate: number;
      params: SealParams;
      sourceTempOverride: number | null;
    }
  | { id: number; type: 'export'; selected: number[]; params: SealParams; sourceTempOverride: number | null }
  | { id: number; type: 'plainText'; plate: number; which: 'before' | 'after'; params: SealParams; sourceTempOverride: number | null };

export type WorkerResponse =
  | { id: number; ok: true; result: LoadResult | ProcessResult | ExportResult | { text: string } }
  | { id: number; ok: false; error: string };
