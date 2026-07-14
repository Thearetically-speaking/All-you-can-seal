/**
 * Line-by-line parameter tracer for the raw G-code viewer.
 * G-code is modal: a parameter keeps its last value until a line explicitly
 * changes it. For each of the four seal parameters this builds the ordered
 * list of "set" events, so the viewer can show the value in effect at any
 * line with a binary search instead of storing one value per line.
 */

export type TraceParam = 'temp' | 'flow' | 'speed' | 'z';

export interface TraceEvent {
  /** 0-based line index of the line that sets the value. */
  line: number;
  value: number;
}

export type GcodeTrace = Record<TraceParam, TraceEvent[]>;

export const TRACE_PARAMS: TraceParam[] = ['temp', 'flow', 'speed', 'z'];

// Command that owns the parameter (checked against the pre-comment code part).
const CMD_RE: Record<TraceParam, RegExp> = {
  temp: /^\s*M10[49]\b/, // M104 / M109 nozzle temp
  flow: /^\s*M221\b/, // extrusion multiplier (percent)
  speed: /^\s*G[0123]\b/, // modal feedrate on any motion command
  z: /^\s*G29\.1\b/, // Bambu global Z offset
};

// Word carrying the value within that command.
const WORD_RE: Record<TraceParam, RegExp> = {
  temp: /\bS(-?\d+(?:\.\d+)?)/,
  flow: /\bS(-?\d+(?:\.\d+)?)/,
  speed: /\bF(-?\d+(?:\.\d+)?)/,
  z: /\bZ(-?\d+(?:\.\d+)?)/,
};

export interface TokenMatch {
  value: number;
  /** Character span of the matched word in the line, for token highlighting. */
  start: number;
  end: number;
}

/** Does this line explicitly set the parameter? Comments are ignored. */
export function matchParamOnLine(line: string, param: TraceParam): TokenMatch | null {
  const semi = line.indexOf(';');
  const code = semi === -1 ? line : line.slice(0, semi);
  if (!CMD_RE[param].test(code)) return null;
  const m = code.match(WORD_RE[param]);
  if (!m || m.index === undefined) return null;
  return { value: parseFloat(m[1]), start: m.index, end: m.index + m[0].length };
}

/** One pass over all lines; cheap first-letter dispatch keeps big files fast. */
export function traceGcode(lines: string[]): GcodeTrace {
  const out: GcodeTrace = { temp: [], flow: [], speed: [], z: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
    const c = line[j];
    if (c === 'M') {
      pushIfSet(out.temp, line, i, 'temp');
      pushIfSet(out.flow, line, i, 'flow');
    } else if (c === 'G') {
      pushIfSet(out.speed, line, i, 'speed');
      pushIfSet(out.z, line, i, 'z');
    }
  }
  return out;
}

function pushIfSet(events: TraceEvent[], line: string, index: number, param: TraceParam) {
  const m = matchParamOnLine(line, param);
  if (m) events.push({ line: index, value: m.value });
}

/** Last event at or before `line` (the value in effect there), or null before the first set. */
export function valueAt(events: TraceEvent[], line: number): TraceEvent | null {
  let lo = 0;
  let hi = events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].line <= line) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? events[ans] : null;
}
