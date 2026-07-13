/**
 * Export-gate safety checks (FR-6). Pure: derives a checklist from the parse
 * info of the original file plus the rewrite result.
 */
import { findMachine } from './machines';
import { extractBodyLines, findResidualFastLines } from './rewrite';
import { CheckItem, CheckSummary, GcodeInfo, MachineDef, RewriteResult, SealParams, Z_WARN_BELOW } from './types';

export interface CheckInput {
  info: GcodeInfo;
  rewrite: RewriteResult;
  params: SealParams;
  machine?: MachineDef;
}

export function runChecks({ info, rewrite, params, machine }: CheckInput): CheckSummary {
  const m = machine ?? findMachine(info.machineName ?? info.printerModel);
  const items: CheckItem[] = [];
  const hard = (id: string, ok: boolean, data: CheckItem['data'] = {}) =>
    items.push({ id, severity: 'hard', status: ok ? 'pass' : 'fail', data });
  const warn = (id: string, ok: boolean, data: CheckItem['data'] = {}) =>
    items.push({ id, severity: 'warn', status: ok ? 'pass' : 'warn', data });

  // -- hard checks ----------------------------------------------------------
  hard('markers', rewrite.missingMarkers.length === 0, {
    missing: rewrite.missingMarkers.join(', '),
  });

  // Executable vs config counts are reported separately: config-only changes
  // must never masquerade as a successful temperature rewrite.
  hard('temp-exec', rewrite.ok && rewrite.report.tempExecChanges > 0, {
    exec: rewrite.report.tempExecChanges,
    config: rewrite.report.tempConfigChanges,
    sources: rewrite.report.sourceTempsUsed.join('/') || '?',
  });

  hard('m221', rewrite.ok && rewrite.report.vt0Found, {
    flow: Math.round(params.flowRate),
  });

  const residual = rewrite.ok ? findResidualFastLines(extractBodyLines(rewrite.text), params.travelSpeed) : [];
  hard('residual-speed', rewrite.ok && residual.length === 0, {
    count: residual.length,
    example: residual[0]?.text ?? '',
  });

  hard('max-temp', params.nozzleTemp <= m.maxHotendTemp, {
    target: params.nozzleTemp,
    max: m.maxHotendTemp,
    machine: m.key === 'unknown' ? (info.machineName ?? '?') : m.names[0],
  });

  // -- warning checks -------------------------------------------------------
  warn('already-processed', info.processedMarker === null, {
    marker: info.processedMarker?.raw ?? '',
    version: info.processedMarker?.version ?? '',
  });

  warn('corrupt-lines', info.corruptLines.length === 0, {
    count: info.corruptLines.length,
    example: info.corruptLines[0]?.text ?? '',
    lineNo: info.corruptLines[0]?.lineNo ?? 0,
  });

  warn('machine-verified', m.verified, {
    machine: info.machineName ?? info.printerModel ?? '?',
  });

  // The G29.1 line was found if we changed it or it already carried the target value.
  warn('textured-pei', rewrite.ok && (rewrite.report.zChanges > 0 || rewrite.report.zOld !== null), {
    bedType: info.bedType ?? '?',
    z: params.zOffset,
  });

  warn('z-deep', params.zOffset >= Z_WARN_BELOW, {
    z: params.zOffset,
    threshold: Z_WARN_BELOW,
  });

  const canExport = items.every((i) => i.severity !== 'hard' || i.status === 'pass');
  // If markers are missing nothing was rewritten, so even a forced export is meaningless.
  const canForceExport = rewrite.ok;
  return { items, canExport, canForceExport };
}
