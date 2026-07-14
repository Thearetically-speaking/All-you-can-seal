/**
 * Pure G-code rewrite engine (FR-4 / FR-8).
 * Port of allyoucanseal-bambu.py with the known defects fixed:
 *  - source print temperature is detected from the config header, not hardcoded 230;
 *  - missing structure markers abort the whole rewrite (no half-rewritten output);
 *  - a processing marker is injected for provenance / double-processing detection.
 * Everything here is text-in / text-out — no DOM, no zip, no side effects.
 */
import {
  Boundaries,
  ENGINE_VERSION,
  GcodeInfo,
  ProcessedMarker,
  RewriteReport,
  RewriteResult,
  SealParams,
} from './types';

export const MARKER_PREFIX = '; allyoucanseal: processed';

const MARKER_NAMES: Record<keyof Boundaries, string> = {
  configEnd: 'CONFIG_BLOCK_END',
  machineStart: 'MACHINE_START_GCODE_END',
  machineEnd: 'MACHINE_END_GCODE_START',
};

/** Split preserving line endings, python splitlines(keepends=True) style. */
export function splitKeepEnds(text: string): string[] {
  if (text === '') return [];
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function fmtNum(value: number): string {
  // Compact float formatting like python's %g for our value ranges.
  return String(parseFloat(value.toPrecision(10)));
}

export function fmtTemp(value: number): string {
  return Number.isInteger(value) ? String(value) : fmtNum(value);
}

export function fmtZ(value: number): string {
  return fmtNum(value);
}

export function fmtFlowRatio(flowPercent: number): string {
  return fmtNum(flowPercent / 100);
}

export function parseBoundaries(lines: string[]): Boundaries {
  const b: Boundaries = { configEnd: null, machineStart: null, machineEnd: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (b.configEnd === null && line.includes('; CONFIG_BLOCK_END')) b.configEnd = i;
    if (b.machineStart === null && line.includes('; MACHINE_START_GCODE_END')) b.machineStart = i;
    if (b.machineEnd === null && line.includes('; MACHINE_END_GCODE_START')) b.machineEnd = i;
  }
  return b;
}

export function missingMarkerNames(b: Boundaries): string[] {
  return (Object.keys(MARKER_NAMES) as (keyof Boundaries)[])
    .filter((k) => b[k] === null)
    .map((k) => MARKER_NAMES[k]);
}

/** Read "; key = value" from the config header; returns the raw value string. */
export function readConfigValue(lines: string[], key: string, until?: number | null): string | null {
  const re = new RegExp(`^\\s*;\\s*${escapeRe(key)}\\s*=\\s*(.*?)\\s*$`);
  const end = until ?? lines.length;
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(re);
    if (m) return m[1];
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Config values may be per-filament lists like "230,230" — take the first number. */
function firstNumber(value: string | null): number | null {
  if (value == null) return null;
  const m = value.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const CORRUPT_LINE_RE = /^\s*M1\d\d(?:\.\d+)?\s+[^;\r\n]*[SHPR]-?\d+(?:\.\d+)?M\d/;

function parseMarker(line: string): ProcessedMarker | null {
  if (!line.startsWith(MARKER_PREFIX)) return null;
  const m = line.match(/processed\s+v(\S+)\s+params=(\{.*\})/);
  let params: ProcessedMarker['params'] = null;
  if (m) {
    try {
      params = JSON.parse(m[2]);
    } catch {
      params = null;
    }
  }
  return { version: m ? m[1] : 'unknown', params, raw: line.trim() };
}

/** Parse all static facts the UI and checks need from one plate's G-code (FR-1 / FR-8). */
export function parseGcodeInfo(text: string): GcodeInfo {
  const lines = splitKeepEnds(text);
  const boundaries = parseBoundaries(lines);
  const configEnd = boundaries.configEnd;

  let machineName: string | null = null;
  let bedType: string | null = null;
  let hasTexturedPeiLine = false;
  let hasVT0 = false;
  let totalLayers: number | null = null;
  let modelPrintingTime: string | null = null;
  let processedMarker: ProcessedMarker | null = null;
  const corruptLines: GcodeInfo['corruptLines'] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (processedMarker === null) {
      const marker = parseMarker(line);
      if (marker) processedMarker = marker;
    }
    if (totalLayers === null) {
      const m = line.match(/^;\s*total layer number:\s*(\d+)/);
      if (m) totalLayers = parseInt(m[1], 10);
    }
    if (modelPrintingTime === null) {
      const m = line.match(/^;\s*model printing time:\s*([^;\r\n]+)/);
      if (m) modelPrintingTime = m[1].trim();
    }
    // Only trust markers in the executable section (the config header embeds the
    // whole start-gcode template on a single line).
    if (configEnd === null || i > configEnd) {
      if (machineName === null) {
        const m = line.match(/^;=+\s*machine:\s*(.*?)\s*=*\s*$/);
        if (m) machineName = m[1];
      }
      if (bedType === null) {
        const m = line.match(/^;\s*curr_bed_type\s*=\s*(.*?)\s*$/);
        if (m) bedType = m[1];
      }
      if (!hasTexturedPeiLine && /^\s*G29\.1\s+Z-?\d+(?:\.\d+)?\s*;\s*for Textured PEI Plate/.test(line)) {
        hasTexturedPeiLine = true;
      }
      if (!hasVT0 && line.trimStart().startsWith(';VT0')) hasVT0 = true;
      if (CORRUPT_LINE_RE.test(line)) {
        corruptLines.push({ lineNo: i + 1, text: line.trim() });
      }
    }
  }

  const printerModel = readConfigValue(lines, 'printer_model', configEnd);
  return {
    boundaries,
    missingMarkers: missingMarkerNames(boundaries),
    printerModel,
    machineName: machineName ?? printerModel,
    totalLayers,
    modelPrintingTime,
    sourceTempInitial: firstNumber(readConfigValue(lines, 'nozzle_temperature_initial_layer', configEnd)),
    sourceTempNozzle: firstNumber(readConfigValue(lines, 'nozzle_temperature', configEnd)),
    bedType,
    hasTexturedPeiLine,
    hasVT0,
    processedMarker,
    corruptLines,
  };
}

function replaceConfigValue(
  lines: string[],
  key: string,
  newValue: string,
): { count: number; oldValue: string | null } {
  const re = new RegExp(`^(\\s*;\\s*${escapeRe(key)}\\s*=\\s*)([^\\r\\n]*?)(\\s*)(\\r?\\n?)$`);
  let count = 0;
  let oldValue: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const [, prefix, value, , lineEnd] = m;
    if (oldValue === null) oldValue = value.trim();
    if (value.trim() === newValue) continue;
    lines[i] = `${prefix}${newValue}${lineEnd}`;
    count++;
  }
  return { count, oldValue };
}

const M10X_RE = /^(\s*M10[49]\s+S)(-?\d+(?:\.\d+)?)([^\r\n]*)(\r?\n?)$/;

function applyNozzleTempInStartup(
  lines: string[],
  sourceTemps: number[],
  excludedTemps: number[],
  targetTemp: number,
): { count: number; firstOld: string | null } {
  const replacement = fmtTemp(targetTemp);
  let count = 0;
  let firstOld: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(M10X_RE);
    if (!m) continue;
    const [, prefix, valueStr, suffix, lineEnd] = m;
    const value = parseFloat(valueStr);
    if (excludedTemps.includes(value)) continue;
    if (!sourceTemps.includes(value)) continue;
    if (valueStr === replacement) continue;
    if (firstOld === null) firstOld = valueStr;
    lines[i] = `${prefix}${replacement}${suffix}${lineEnd}`;
    count++;
  }
  return { count, firstOld };
}

const G291_RE = /^(\s*G29\.1\s+Z)(-?\d+(?:\.\d+)?)(\s*;\s*for Textured PEI Plate\s*?)(\r?\n?)$/;

function applyZOffsetInStartup(lines: string[], zOffset: number): { count: number; oldZ: string | null } {
  const replacement = fmtZ(zOffset);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(G291_RE);
    if (!m) continue;
    const [, prefix, oldZ, suffix, lineEnd] = m;
    if (oldZ === replacement) return { count: 0, oldZ };
    lines[i] = `${prefix}${replacement}${suffix}${lineEnd}`;
    return { count: 1, oldZ };
  }
  return { count: 0, oldZ: null };
}

function injectM221AfterVT0(lines: string[], flowRate: number): { injected: number; vt0Found: boolean } {
  const target = `M221 S${Math.round(flowRate)}`;
  let vt0Index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith(';VT0')) {
      vt0Index = i;
      break;
    }
  }
  if (vt0Index === -1) return { injected: 0, vt0Found: false };

  let searchEnd = lines.length;
  for (let i = vt0Index + 1; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith('G0') || stripped.startsWith('G1')) {
      searchEnd = i;
      break;
    }
  }
  for (let i = vt0Index + 1; i < searchEnd; i++) {
    if (lines[i].trim().startsWith('M221 S')) {
      if (lines[i].trim() === target) return { injected: 0, vt0Found: true };
      lines[i] = target + '\n';
      return { injected: 1, vt0Found: true };
    }
  }
  lines.splice(vt0Index + 1, 0, target + '\n');
  return { injected: 1, vt0Found: true };
}

const STANDALONE_F_RE = /^\s*G1\s+F-?\d+(?:\.\d+)?\s*(?:;[^\r\n]*)?(\r?\n?)$/;
// Negative lookahead keeps "F30000.1" (a distinct Bambu feedrate) intact.
const INLINE_F30000_RE = /\bF30000(?![\d.])/g;

function applyTravelSpeedInBody(lines: string[], travelSpeed: number): number {
  const targetFeed = Math.round(travelSpeed * 60);
  const standaloneTarget = `G1 F${targetFeed}`;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const sm = lines[i].match(STANDALONE_F_RE);
    if (sm) {
      const newline = sm[1] || '\n';
      const replacement = `${standaloneTarget}${newline}`;
      if (lines[i] !== replacement) {
        lines[i] = replacement;
        count++;
      }
      continue;
    }
    const replaced = lines[i].replace(INLINE_F30000_RE, `F${targetFeed}`);
    if (replaced !== lines[i]) {
      lines[i] = replaced;
      count++;
    }
  }
  return count;
}

/** Standalone "G1 F<n>" body lines whose feedrate exceeds the target — used by the FR-6 reverse assertion. */
export function findResidualFastLines(
  bodyLines: string[],
  travelSpeed: number,
): { lineNo: number; text: string }[] {
  const targetFeed = Math.round(travelSpeed * 60);
  const out: { lineNo: number; text: string }[] = [];
  const re = /^\s*G1\s+F(-?\d+(?:\.\d+)?)\s*(?:;[^\r\n]*)?$/;
  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].replace(/\r?\n$/, '').match(re);
    if (m && parseFloat(m[1]) > targetFeed) {
      out.push({ lineNo: i + 1, text: bodyLines[i].trim() });
    }
  }
  return out;
}

export interface RewriteOptions {
  /** Fixed process temps for the detected machine that must never be rewritten. */
  excludedTemps: number[];
  /** Manual source temperature when the config header lacks the keys (FR-8 fallback). */
  sourceTempOverride?: number | null;
}

export function rewriteGcode(text: string, params: SealParams, options: RewriteOptions): RewriteResult {
  const lines = splitKeepEnds(text);
  const boundaries = parseBoundaries(lines);
  const missing = missingMarkerNames(boundaries);

  const report: RewriteReport = {
    tempExecChanges: 0,
    tempConfigChanges: 0,
    tempOld: null,
    sourceTempsUsed: [],
    zChanges: 0,
    zOld: null,
    vt0Found: false,
    flowInjected: 0,
    flowConfigChanges: 0,
    flowConfigOld: null,
    travelChanges: 0,
    markerInjected: false,
  };

  // FR-6: any missing structure marker means we do not touch the file at all.
  if (missing.length > 0) {
    return { ok: false, text, report, missingMarkers: missing };
  }

  const configEnd = boundaries.configEnd!;
  const machineStart = boundaries.machineStart!;
  const machineEnd = boundaries.machineEnd!;

  // FR-8: detect the sliced print temperature from the config header.
  const sourceTemps: number[] = [];
  if (options.sourceTempOverride != null) {
    sourceTemps.push(options.sourceTempOverride);
  } else {
    const initial = firstNumber(readConfigValue(lines, 'nozzle_temperature_initial_layer', configEnd));
    const nozzle = firstNumber(readConfigValue(lines, 'nozzle_temperature', configEnd));
    for (const t of [initial, nozzle]) {
      if (t != null && !sourceTemps.includes(t)) sourceTemps.push(t);
    }
  }
  report.sourceTempsUsed = sourceTemps;

  // Startup section: nozzle temp + Z offset.
  const startup = lines.slice(configEnd + 1, machineStart + 1);
  const temp = applyNozzleTempInStartup(startup, sourceTemps, options.excludedTemps, params.nozzleTemp);
  const z = applyZOffsetInStartup(startup, params.zOffset);
  lines.splice(configEnd + 1, machineStart + 1 - (configEnd + 1), ...startup);
  report.tempExecChanges = temp.count;
  report.tempOld = temp.firstOld;
  report.zChanges = z.count;
  report.zOld = z.oldZ;

  // Config header: keep it consistent with what we actually do.
  const header = lines.slice(0, configEnd + 1);
  const c1 = replaceConfigValue(header, 'nozzle_temperature', fmtTemp(params.nozzleTemp));
  const c2 = replaceConfigValue(header, 'nozzle_temperature_initial_layer', fmtTemp(params.nozzleTemp));
  const cf = replaceConfigValue(header, 'filament_flow_ratio', fmtFlowRatio(params.flowRate));
  lines.splice(0, configEnd + 1, ...header);
  report.tempConfigChanges = c1.count + c2.count;
  report.flowConfigChanges = cf.count;
  report.flowConfigOld = cf.oldValue;
  if (report.tempOld === null && c1.oldValue !== null) report.tempOld = c1.oldValue;

  // Body: M221 flow + travel speed.
  const body = lines.slice(machineStart + 1, machineEnd);
  const flow = injectM221AfterVT0(body, params.flowRate);
  report.vt0Found = flow.vt0Found;
  report.flowInjected = flow.injected;
  report.travelChanges = applyTravelSpeedInBody(body, params.travelSpeed);
  lines.splice(machineStart + 1, machineEnd - (machineStart + 1), ...body);

  // FR-4.5: provenance marker at the very top.
  const paramsJson = JSON.stringify(params);
  lines.unshift(`${MARKER_PREFIX} v${ENGINE_VERSION} params=${paramsJson}\n`);
  report.markerInjected = true;

  return { ok: true, text: lines.join(''), report, missingMarkers: [] };
}

/** Slice out the body section (between MACHINE_START_GCODE_END and MACHINE_END_GCODE_START). */
export function extractBodyLines(text: string): string[] {
  const lines = splitKeepEnds(text);
  const b = parseBoundaries(lines);
  if (b.machineStart === null || b.machineEnd === null || b.machineStart >= b.machineEnd) return [];
  return lines.slice(b.machineStart + 1, b.machineEnd);
}
