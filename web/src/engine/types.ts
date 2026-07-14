export const ENGINE_VERSION = '0.1.0';

/** The four heat-seal parameters (FR-3). */
export interface SealParams {
  /** Nozzle temperature in °C. */
  nozzleTemp: number;
  /** Z offset in mm; negative presses into the film. */
  zOffset: number;
  /** Flow rate in percent, injected as M221. */
  flowRate: number;
  /** Travel speed in mm/s applied to standalone G1 F lines in the body. */
  travelSpeed: number;
}

export const DEFAULT_PARAMS: SealParams = {
  nozzleTemp: 260,
  zOffset: -0.15,
  flowRate: 120,
  travelSpeed: 5,
};

/** Hard input limits (FR-3). nozzleTemp max is further clamped per machine. */
export const PARAM_LIMITS = {
  nozzleTemp: { min: 180, max: 300, step: 1 },
  zOffset: { min: -0.3, max: 0.1, step: 0.01 },
  flowRate: { min: 50, max: 200, step: 1 },
  travelSpeed: { min: 1, max: 30, step: 0.5 },
} as const;

/** Yellow-warning threshold for Z offset (FR-3 / FR-6). */
export const Z_WARN_BELOW = -0.2;

export interface MachineDef {
  key: string;
  names: string[];
  bed: [number, number];
  maxHotendTemp: number;
  processTemps: number[];
  verified: boolean;
}

export interface Boundaries {
  configEnd: number | null;
  machineStart: number | null;
  machineEnd: number | null;
}

export interface ProcessedMarker {
  version: string;
  params: Partial<SealParams> | null;
  raw: string;
}

/** Static facts parsed from one plate's G-code (FR-1 / FR-8). */
export interface GcodeInfo {
  boundaries: Boundaries;
  missingMarkers: string[];
  printerModel: string | null;
  machineName: string | null;
  totalLayers: number | null;
  modelPrintingTime: string | null;
  /** ; nozzle_temperature_initial_layer — first value, °C. */
  sourceTempInitial: number | null;
  /** ; nozzle_temperature — first value, °C. */
  sourceTempNozzle: number | null;
  bedType: string | null;
  hasTexturedPeiLine: boolean;
  hasVT0: boolean;
  processedMarker: ProcessedMarker | null;
  /** Lines like "M104 S260M140 S30" produced by the buggy legacy script. */
  corruptLines: { lineNo: number; text: string }[];
}

export interface RewriteReport {
  /** M104/M109 lines changed in the executable startup section. */
  tempExecChanges: number;
  /** nozzle_temperature / nozzle_temperature_initial_layer config lines changed. */
  tempConfigChanges: number;
  tempOld: string | null;
  /** Which source temperatures were used to match M104/M109 lines. */
  sourceTempsUsed: number[];
  zChanges: number;
  zOld: string | null;
  vt0Found: boolean;
  flowInjected: number;
  flowConfigChanges: number;
  flowConfigOld: string | null;
  travelChanges: number;
  markerInjected: boolean;
}

export interface RewriteResult {
  /** False when a structure marker is missing: text is returned unchanged (FR-6: never emit a half-rewritten file). */
  ok: boolean;
  text: string;
  report: RewriteReport;
  missingMarkers: string[];
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckItem {
  id: string;
  severity: 'hard' | 'warn';
  status: CheckStatus;
  /** Values interpolated into the localized description. */
  data: Record<string, string | number>;
}

export interface CheckSummary {
  items: CheckItem[];
  /** All hard checks pass. */
  canExport: boolean;
  /** Rewrite actually ran (markers present) so a force-export is at least meaningful. */
  canForceExport: boolean;
}
