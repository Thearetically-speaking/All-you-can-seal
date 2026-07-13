/**
 * Seal worker: all parsing, rewriting and repacking runs here so the UI stays
 * responsive (PRD §4 performance). The loaded file lives in worker memory —
 * nothing ever leaves the browser.
 */
import { parseGcodeInfo, rewriteGcode } from '../engine/rewrite';
import { runChecks } from '../engine/checks';
import { findMachine } from '../engine/machines';
import { parseToolpath } from '../engine/toolpath';
import { openThreeMf, repackThreeMf, sealedFileName, ThreeMf } from '../engine/threemf';
import type { GcodeInfo, RewriteResult, SealParams } from '../engine/types';
import type { LoadResult, PlateProcessResult, ProcessResult, WorkerRequest, WorkerResponse } from './protocol';

interface PlateState {
  index: number;
  text: string;
  info: GcodeInfo;
}

let fileName = '';
let kind: '3mf' | 'gcode' = 'gcode';
let threeMf: ThreeMf | null = null;
let plates: PlateState[] = [];

function load(name: string, buffer: ArrayBuffer): LoadResult {
  fileName = name;
  const bytes = new Uint8Array(buffer);
  const lower = name.toLowerCase();
  plates = [];
  threeMf = null;

  if (lower.endsWith('.gcode') && !lower.endsWith('.gcode.3mf')) {
    kind = 'gcode';
    const text = new TextDecoder().decode(bytes);
    plates = [{ index: 1, text, info: parseGcodeInfo(text) }];
    return {
      kind,
      fileName: name,
      plates: [{ index: 1, info: plates[0].info, gcodeBytes: bytes.length, thumbnail: null }],
    };
  }

  kind = '3mf';
  threeMf = openThreeMf(bytes); // throws not-a-zip / no-plate-gcode with specific codes
  plates = threeMf.plates.map((p) => ({ index: p.index, text: p.text, info: parseGcodeInfo(p.text) }));
  return {
    kind,
    fileName: name,
    plates: threeMf.plates.map((p, i) => ({
      index: p.index,
      info: plates[i].info,
      gcodeBytes: p.text.length,
      // Copy: the thumbnail may be a view into the zip buffer, and transferring
      // that view's buffer would detach the whole archive we still need.
      thumbnail: p.thumbnail ? p.thumbnail.slice() : null,
    })),
  };
}

function rewritePlate(plate: PlateState, params: SealParams, sourceTempOverride: number | null): RewriteResult {
  const machine = findMachine(plate.info.machineName ?? plate.info.printerModel);
  return rewriteGcode(plate.text, params, {
    excludedTemps: machine.processTemps,
    sourceTempOverride,
  });
}

function process(
  selected: number[],
  previewPlate: number,
  params: SealParams,
  sourceTempOverride: number | null,
): { result: ProcessResult; transfers: Transferable[] } {
  const results: PlateProcessResult[] = [];
  let previewText: string | null = null;

  for (const idx of selected) {
    const plate = plates.find((p) => p.index === idx);
    if (!plate) continue;
    const machine = findMachine(plate.info.machineName ?? plate.info.printerModel);
    const rewrite = rewritePlate(plate, params, sourceTempOverride);
    const checks = runChecks({ info: plate.info, rewrite, params, machine });
    results.push({ index: idx, ok: rewrite.ok, report: rewrite.report, checks });
    if (idx === previewPlate) previewText = rewrite.ok ? rewrite.text : plate.text;
  }

  if (previewText === null) {
    const plate = plates.find((p) => p.index === previewPlate) ?? plates[0];
    if (plate) {
      const rewrite = rewritePlate(plate, params, sourceTempOverride);
      previewText = rewrite.ok ? rewrite.text : plate.text;
      previewPlate = plate.index;
    }
  }

  const toolpath = previewText !== null ? parseToolpath(previewText) : null;
  const transfers: Transferable[] = [];
  if (toolpath) {
    transfers.push(
      toolpath.positions.buffer,
      toolpath.feeds.buffer,
      toolpath.extrude.buffer,
      toolpath.layerOf.buffer,
      toolpath.lineNo.buffer,
      toolpath.sealPrefix.buffer,
      toolpath.travelPrefix.buffer,
    );
  }
  return { result: { plates: results, toolpath, previewPlate }, transfers };
}

function exportFile(selected: number[], params: SealParams, sourceTempOverride: number | null): { fileName: string; bytes: Uint8Array } {
  if (kind === 'gcode') {
    const rewrite = rewritePlate(plates[0], params, sourceTempOverride);
    if (!rewrite.ok) throw new Error('markers-missing');
    return { fileName: sealedFileName(fileName), bytes: new TextEncoder().encode(rewrite.text) };
  }
  if (!threeMf) throw new Error('no-file');
  const rewritten = new Map<number, string>();
  for (const idx of selected) {
    const plate = plates.find((p) => p.index === idx);
    if (!plate) continue;
    const rewrite = rewritePlate(plate, params, sourceTempOverride);
    if (!rewrite.ok) throw new Error('markers-missing');
    rewritten.set(idx, rewrite.text);
  }
  if (rewritten.size === 0) throw new Error('nothing-selected');
  return { fileName: sealedFileName(fileName), bytes: repackThreeMf(threeMf, rewritten) };
}

function plainText(plateIdx: number, which: 'before' | 'after', params: SealParams, sourceTempOverride: number | null): string {
  const plate = plates.find((p) => p.index === plateIdx);
  if (!plate) throw new Error('no-plate');
  if (which === 'before') return plate.text;
  const rewrite = rewritePlate(plate, params, sourceTempOverride);
  return rewrite.text;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      const result = load(msg.fileName, msg.buffer);
      const transfers = result.plates.flatMap((p) => (p.thumbnail ? [p.thumbnail.buffer as Transferable] : []));
      respond({ id: msg.id, ok: true, result }, transfers);
    } else if (msg.type === 'process') {
      const { result, transfers } = process(msg.selected, msg.previewPlate, msg.params, msg.sourceTempOverride);
      respond({ id: msg.id, ok: true, result }, transfers);
    } else if (msg.type === 'export') {
      const result = exportFile(msg.selected, msg.params, msg.sourceTempOverride);
      respond({ id: msg.id, ok: true, result }, [result.bytes.buffer]);
    } else if (msg.type === 'plainText') {
      respond({ id: msg.id, ok: true, result: { text: plainText(msg.plate, msg.which, msg.params, msg.sourceTempOverride) } });
    }
  } catch (err) {
    respond({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

function respond(msg: WorkerResponse, transfers: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfers);
}
