import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  extractBodyLines,
  findResidualFastLines,
  parseGcodeInfo,
  rewriteGcode,
  MARKER_PREFIX,
} from '../src/engine/rewrite';
import { inspectGcode } from '../src/engine/inspect';
import { runChecks } from '../src/engine/checks';
import { findMachine } from '../src/engine/machines';
import { parseToolpath } from '../src/engine/toolpath';
import { md5HexUpper, openThreeMf, repackThreeMf, sealedFileName } from '../src/engine/threemf';
import { entryData, readZip } from '../src/engine/zip';
import { DEFAULT_PARAMS } from '../src/engine/types';

const here = dirname(fileURLToPath(import.meta.url));
const clean = readFileSync(resolve(here, 'fixtures/clean.gcode'), 'utf-8');
// The real 3mf in the repo root: processed by the legacy script and containing
// its corrupted concatenated lines — our negative fixture (see PRD §4).
const legacy3mf = new Uint8Array(readFileSync(resolve(here, '../../test1.gcode.3mf')));

const a1mini = findMachine('A1 mini');
const opts = { excludedTemps: a1mini.processTemps };

describe('parseGcodeInfo', () => {
  it('reads structure, machine and source temps from a clean file', () => {
    const info = parseGcodeInfo(clean);
    expect(info.missingMarkers).toEqual([]);
    expect(info.printerModel).toBe('Bambu Lab A1 mini');
    expect(info.machineName).toBe('A1 mini');
    expect(info.totalLayers).toBe(2);
    expect(info.sourceTempInitial).toBe(230);
    expect(info.sourceTempNozzle).toBe(230);
    expect(info.bedType).toBe('Textured PEI Plate');
    expect(info.hasVT0).toBe(true);
    expect(info.hasTexturedPeiLine).toBe(true);
    expect(info.processedMarker).toBeNull();
    expect(info.corruptLines).toEqual([]);
  });

  it('detects legacy-script corruption in the real processed file', () => {
    const { plates } = openThreeMf(legacy3mf);
    const info = parseGcodeInfo(plates[0].text);
    expect(info.machineName).toBe('A1 mini');
    expect(info.corruptLines.length).toBeGreaterThanOrEqual(2);
    expect(info.corruptLines[0].text).toContain('M104 S260M140');
  });
});

describe('rewriteGcode', () => {
  it('rewrites all four parameter families with detected source temp (FR-8)', () => {
    const res = rewriteGcode(clean, DEFAULT_PARAMS, opts);
    expect(res.ok).toBe(true);
    const r = res.report;
    expect(r.sourceTempsUsed).toEqual([230]);
    expect(r.tempExecChanges).toBe(4); // M109 S230, M104 S230, M109 S230 H170, M104 S230
    expect(r.tempConfigChanges).toBe(2);
    expect(r.tempOld).toBe('230');
    expect(r.zChanges).toBe(1);
    expect(r.zOld).toBe('-0.04');
    expect(r.vt0Found).toBe(true);
    expect(r.flowInjected).toBe(1);
    expect(r.flowConfigChanges).toBe(1);
    expect(r.flowConfigOld).toBe('0.98');
    expect(r.travelChanges).toBe(2); // two standalone G1 F30000 lines in the body
    expect(r.markerInjected).toBe(true);

    const out = res.text;
    expect(out.startsWith(MARKER_PREFIX)).toBe(true);
    expect(out).toContain('; nozzle_temperature = 260');
    expect(out).toContain('; nozzle_temperature_initial_layer = 260');
    expect(out).toContain('; filament_flow_ratio = 1.2');
    expect(out).toContain('G29.1 Z-0.17 ; for Textured PEI Plate');
    expect(out).toContain(';VT0 H-1\nM221 S120\n');
    // fixed process temps untouched
    expect(out).toContain('M109 S250 ;set nozzle to common flush temp');
    expect(out).toContain('M104 S170');
    expect(out).toContain('M109 S100 H170');
    // no source-temp lines left in the executable section
    expect(out).not.toMatch(/M10[49] S230/);
    expect(out).toContain('M109 S260 H170');
    // standalone body speed lines rewritten, F30000.1 must survive
    const body = extractBodyLines(out);
    expect(body.filter((l) => l.trim() === 'G1 F300').length).toBe(2);
    expect(out).toContain('G1 X25 Y175 F30000.1');
  });

  it('matches both temps separately when initial layer differs (FR-8)', () => {
    const mixed = clean
      .replace('; nozzle_temperature_initial_layer = 230', '; nozzle_temperature_initial_layer = 235')
      .replace('M109 S230 H170', 'M109 S235 H170');
    const res = rewriteGcode(mixed, DEFAULT_PARAMS, opts);
    expect(res.report.sourceTempsUsed).toEqual([235, 230]);
    expect(res.report.tempExecChanges).toBe(4);
    expect(res.text).not.toMatch(/M10[49] S23[05]/);
  });

  it('never rewrites fixed process temps even when they equal the source temp', () => {
    const at250 = clean
      .replace('; nozzle_temperature = 230', '; nozzle_temperature = 250')
      .replace('; nozzle_temperature_initial_layer = 230', '; nozzle_temperature_initial_layer = 250');
    const res = rewriteGcode(at250, DEFAULT_PARAMS, opts);
    // 250 is a flush temp on the A1 mini: the S230 lines no longer match the
    // source temp and the S250 flush line is protected -> zero exec changes.
    expect(res.report.tempExecChanges).toBe(0);
    expect(res.text).toContain('M109 S250 ;set nozzle to common flush temp');
  });

  it('aborts completely when a structure marker is missing (FR-6)', () => {
    const broken = clean.replace('; MACHINE_START_GCODE_END\n', '');
    const res = rewriteGcode(broken, DEFAULT_PARAMS, opts);
    expect(res.ok).toBe(false);
    expect(res.missingMarkers).toEqual(['MACHINE_START_GCODE_END']);
    expect(res.text).toBe(broken); // untouched, never half-rewritten
  });

  it('falls back to a manual source temperature when config keys are missing', () => {
    const noKeys = clean
      .replace('; nozzle_temperature = 230\n', '')
      .replace('; nozzle_temperature_initial_layer = 230\n', '');
    const auto = rewriteGcode(noKeys, DEFAULT_PARAMS, opts);
    expect(auto.report.sourceTempsUsed).toEqual([]);
    expect(auto.report.tempExecChanges).toBe(0);
    const manual = rewriteGcode(noKeys, DEFAULT_PARAMS, { ...opts, sourceTempOverride: 230 });
    expect(manual.report.tempExecChanges).toBe(4);
  });

  it('marks output so a second pass is detectable (FR-4.5)', () => {
    const first = rewriteGcode(clean, DEFAULT_PARAMS, opts);
    const info = parseGcodeInfo(first.text);
    expect(info.processedMarker).not.toBeNull();
    expect(info.processedMarker!.params?.nozzleTemp).toBe(260);
  });
});

describe('inspectGcode (validator tab)', () => {
  it('reads the slicer values from an unprocessed file', () => {
    const insp = inspectGcode(clean);
    expect(insp.info.processedMarker).toBeNull();
    // process temps (100/140/170/250) excluded — only the sliced 230 remains
    expect(insp.nozzleTemps).toEqual([{ value: 230, count: 4, example: 'M109 S230' }]);
    expect(insp.zOffset).toEqual({ value: -0.04, count: 1, example: 'G29.1 Z-0.04 ; for Textured PEI Plate' });
    expect(insp.flowPercent).toBeNull();
    expect(insp.configFlowRatio).toBe(0.98);
    expect(insp.travelSpeeds).toEqual([{ value: 500, count: 2, example: 'G1 F30000' }]);
    expect(insp.machine.key).toBe('a1mini');
  });

  it('reads back the four parameters from a sealed file', () => {
    const sealed = rewriteGcode(clean, DEFAULT_PARAMS, opts).text;
    const insp = inspectGcode(sealed);
    expect(insp.info.processedMarker).not.toBeNull();
    expect(insp.nozzleTemps).toEqual([{ value: 260, count: 4, example: 'M109 S260' }]);
    expect(insp.zOffset?.value).toBe(-0.17);
    expect(insp.flowPercent).toEqual({ value: 120, count: 1, example: 'M221 S120' });
    expect(insp.configFlowRatio).toBe(1.2);
    expect(insp.travelSpeeds).toEqual([{ value: 5, count: 2, example: 'G1 F300' }]);
  });

  it('still reports values when structure markers are missing', () => {
    const broken = clean.replace('; MACHINE_START_GCODE_END\n', '').replace('; MACHINE_END_GCODE_START\n', '');
    const insp = inspectGcode(broken);
    expect(insp.nozzleTemps[0]).toMatchObject({ value: 230 });
    expect(insp.zOffset?.value).toBe(-0.04);
  });
});

describe('runChecks', () => {
  it('is all green for a clean rewrite on a verified machine', () => {
    const info = parseGcodeInfo(clean);
    const rewrite = rewriteGcode(clean, DEFAULT_PARAMS, opts);
    const sum = runChecks({ info, rewrite, params: DEFAULT_PARAMS, machine: a1mini });
    expect(sum.canExport).toBe(true);
    expect(sum.items.filter((i) => i.status !== 'pass')).toEqual([]);
  });

  it('fails hard checks on the legacy-processed file (temps already at target)', () => {
    const { plates } = openThreeMf(legacy3mf);
    const info = parseGcodeInfo(plates[0].text);
    const rewrite = rewriteGcode(plates[0].text, DEFAULT_PARAMS, opts);
    const sum = runChecks({ info, rewrite, params: DEFAULT_PARAMS, machine: a1mini });
    expect(sum.canExport).toBe(false);
    const byId = Object.fromEntries(sum.items.map((i) => [i.id, i]));
    expect(byId['temp-exec'].status).toBe('fail');
    expect(byId['corrupt-lines'].status).toBe('warn');
  });

  it('warns for deep Z and blocks temps above the machine limit', () => {
    const info = parseGcodeInfo(clean);
    const params = { ...DEFAULT_PARAMS, zOffset: -0.25, nozzleTemp: 305 };
    const rewrite = rewriteGcode(clean, params, opts);
    const sum = runChecks({ info, rewrite, params, machine: a1mini });
    const byId = Object.fromEntries(sum.items.map((i) => [i.id, i]));
    expect(byId['z-deep'].status).toBe('warn');
    expect(byId['max-temp'].status).toBe('fail');
    expect(sum.canExport).toBe(false);
  });

  it('reverse assertion catches residual fast standalone G1 F lines', () => {
    const residual = findResidualFastLines(['G1 F5000\n', 'G1 X1 Y1 F42000\n', 'G1 F300\n'], 5);
    expect(residual).toEqual([{ lineNo: 1, text: 'G1 F5000' }]);
  });
});

describe('parseToolpath', () => {
  it('parses the rewritten body into segments, layers and lengths', () => {
    const res = rewriteGcode(clean, DEFAULT_PARAMS, opts);
    const tp = parseToolpath(res.text);
    expect(tp.count).toBeGreaterThan(10);
    expect(tp.layers.length).toBe(2);
    expect(tp.layers[0].z).toBeCloseTo(0.2);
    // seal length: 10 + 10 + half circle r=5 (~15.7) + diagonal 20*sqrt(2)
    expect(tp.sealLength).toBeGreaterThan(63);
    expect(tp.sealLength).toBeLessThan(65);
    expect(tp.travelLength).toBeGreaterThan(0);
    expect(tp.estSeconds).toBeGreaterThan(10); // 40mm of seal at 5 mm/s alone is 8s
    expect(tp.positions.length).toBe(tp.count * 6);
    expect(tp.sealPrefix[tp.count] + tp.travelPrefix[tp.count]).toBe(tp.count);
    expect(tp.bbox.maxX).toBeCloseTo(30);
    expect(tp.bbox.maxY).toBeCloseTo(175);
  });
});

describe('3mf repack (FR-2 / FR-7)', () => {
  it('updates gcode + md5 and preserves every other entry byte-for-byte', () => {
    const threeMf = openThreeMf(legacy3mf);
    expect(threeMf.plates.length).toBe(1);
    const plate = threeMf.plates[0];

    const newText = plate.text + '; regression test suffix\n';
    const out = repackThreeMf(threeMf, new Map([[plate.index, newText]]));

    const original = readZip(legacy3mf);
    const repacked = readZip(out);
    expect(repacked.map((e) => e.name)).toEqual(original.map((e) => e.name));

    for (let i = 0; i < original.length; i++) {
      const name = original[i].name;
      if (name === plate.gcodePath) {
        expect(new TextDecoder().decode(entryData(repacked[i]))).toBe(newText);
      } else if (name === plate.md5Path) {
        const md5 = new TextDecoder().decode(entryData(repacked[i]));
        expect(md5).toBe(md5HexUpper(new TextEncoder().encode(newText)));
        expect(md5).toMatch(/^[0-9A-F]{32}$/);
      } else {
        expect(Buffer.from(repacked[i].raw).equals(Buffer.from(original[i].raw))).toBe(true);
      }
    }
  });

  it('demonstrates the legacy stale-md5 defect we fix', () => {
    const threeMf = openThreeMf(legacy3mf);
    const plate = threeMf.plates[0];
    const storedMd5 = new TextDecoder().decode(
      entryData(threeMf.entries.find((e) => e.name === plate.md5Path)!),
    );
    const actualMd5 = md5HexUpper(new TextEncoder().encode(plate.text));
    expect(storedMd5).not.toBe(actualMd5); // legacy script forgot to update it
  });

  it('derives export file names', () => {
    expect(sealedFileName('cat.gcode.3mf')).toBe('cat-sealed.gcode.3mf');
    expect(sealedFileName('cat.gcode')).toBe('cat-sealed.gcode');
  });
});
