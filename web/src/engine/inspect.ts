/**
 * Read-only G-code inspector for the human validator tab.
 * Extracts the four seal parameters actually present in a plate's G-code
 * (nozzle temp, extrusion multiplier, move speed, Z offset) together with the
 * raw evidence lines, so a person can verify a file by eye. Never mutates.
 */
import { parseGcodeInfo, splitKeepEnds } from './rewrite';
import { findMachine } from './machines';
import type { GcodeInfo, MachineDef } from './types';

/** One distinct value found in the G-code, with occurrence count and the first raw line. */
export interface FoundValue {
  value: number;
  count: number;
  /** First matching raw line, trimmed — shown as evidence. */
  example: string;
}

export interface GcodeInspection {
  info: GcodeInfo;
  machine: MachineDef;
  /** Distinct M104/M109 S temps in the startup section, machine process temps excluded. */
  nozzleTemps: FoundValue[];
  /** M221 S value in the body (percent), as injected after ;VT0. */
  flowPercent: FoundValue | null;
  /** filament_flow_ratio from the config header (1.2 == 120%). */
  configFlowRatio: number | null;
  /** Distinct standalone "G1 F…" feeds in the body, converted to mm/s. */
  travelSpeeds: FoundValue[];
  /** G29.1 Z offset ("for Textured PEI Plate") in the startup section, mm. */
  zOffset: FoundValue | null;
}

// Same shapes the rewrite engine targets (rewrite.ts), reduced to read-only matching.
const M10X_RE = /^\s*M10[49]\s+S(-?\d+(?:\.\d+)?)/;
const G291_RE = /^\s*G29\.1\s+Z(-?\d+(?:\.\d+)?)\s*;\s*for Textured PEI Plate/;
const STANDALONE_F_RE = /^\s*G1\s+F(-?\d+(?:\.\d+)?)\s*(?:;[^\r\n]*)?$/;
const M221_RE = /^\s*M221\s+S(-?\d+(?:\.\d+)?)\s*(?:;[^\r\n]*)?$/;

function addFound(map: Map<number, FoundValue>, value: number, line: string) {
  const cur = map.get(value);
  if (cur) cur.count++;
  else map.set(value, { value, count: 1, example: line.trim() });
}

function byCountDesc(map: Map<number, FoundValue>): FoundValue[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.value - b.value);
}

export function inspectGcode(text: string): GcodeInspection {
  const info = parseGcodeInfo(text);
  const machine = findMachine(info.machineName ?? info.printerModel);
  const lines = splitKeepEnds(text);
  const { configEnd, machineStart, machineEnd } = info.boundaries;

  // Fall back to whole-file scanning when structure markers are missing, so the
  // validator still shows something useful for a human to judge.
  const startupStart = (configEnd ?? -1) + 1;
  const startupEnd = machineStart !== null ? machineStart + 1 : lines.length;
  const bodyStart = machineStart !== null ? machineStart + 1 : startupStart;
  const bodyEnd = machineEnd ?? lines.length;

  const temps = new Map<number, FoundValue>();
  let zOffset: FoundValue | null = null;
  for (let i = startupStart; i < startupEnd; i++) {
    const line = lines[i];
    const tm = line.match(M10X_RE);
    if (tm) {
      const value = parseFloat(tm[1]);
      if (!machine.processTemps.includes(value)) addFound(temps, value, line);
    }
    if (zOffset === null) {
      const zm = line.match(G291_RE);
      if (zm) zOffset = { value: parseFloat(zm[1]), count: 1, example: line.trim() };
    }
  }

  let flowPercent: FoundValue | null = null;
  const speeds = new Map<number, FoundValue>();
  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i].replace(/\r?\n$/, '');
    if (flowPercent === null) {
      const fm = line.match(M221_RE);
      if (fm) flowPercent = { value: parseFloat(fm[1]), count: 1, example: line.trim() };
    }
    const sm = line.match(STANDALONE_F_RE);
    // Round to 0.01 mm/s so near-identical feeds group into one display row.
    if (sm) addFound(speeds, Math.round((parseFloat(sm[1]) / 60) * 100) / 100, line);
  }

  const flowRatioRaw = readHeaderFlowRatio(lines, configEnd);

  return {
    info,
    machine,
    nozzleTemps: byCountDesc(temps),
    flowPercent,
    configFlowRatio: flowRatioRaw,
    travelSpeeds: byCountDesc(speeds),
    zOffset,
  };
}

function readHeaderFlowRatio(lines: string[], configEnd: number | null): number | null {
  const re = /^\s*;\s*filament_flow_ratio\s*=\s*(.*?)\s*$/;
  const end = configEnd ?? lines.length;
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(re);
    if (m) {
      const num = m[1].match(/-?\d+(?:\.\d+)?/);
      return num ? parseFloat(num[0]) : null;
    }
  }
  return null;
}
