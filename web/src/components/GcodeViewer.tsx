import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_PARAMS } from '../engine/types';
import { TraceParam, TRACE_PARAMS, matchParamOnLine, traceGcode, valueAt } from '../engine/trace';

const ROW_H = 19;
const VIEW_H = 480;
const OVERSCAN = 10;

const PARAM_LABEL: Record<TraceParam, 'viewer.p.temp' | 'viewer.p.flow' | 'viewer.p.speed' | 'viewer.p.z'> = {
  temp: 'viewer.p.temp',
  flow: 'viewer.p.flow',
  speed: 'viewer.p.speed',
  z: 'viewer.p.z',
};

const PARAM_UNIT: Record<TraceParam, string> = { temp: '°C', flow: '%', speed: 'mm/s', z: 'mm' };
const PARAM_STEP: Record<TraceParam, number> = { temp: 1, flow: 1, speed: 0.5, z: 0.01 };

/** Traced value (feedrate is raw F mm/min) in display units. */
function displayValue(param: TraceParam, value: number): number {
  return param === 'speed' ? parseFloat((value / 60).toFixed(2)) : value;
}

function fmtValue(param: TraceParam, value: number): string {
  const v = displayValue(param, value);
  switch (param) {
    case 'temp':
      return `${v}°C`;
    case 'flow':
      return `${v}%`;
    case 'speed':
      return `${v} mm/s`;
    case 'z':
      return `${v} mm`;
  }
}

/** Does the traced value equal the target (target is in display units)? */
function atTarget(param: TraceParam, value: number, target: number): boolean {
  const v = param === 'speed' ? value / 60 : value;
  return Math.abs(v - target) < (param === 'speed' ? 0.005 : 1e-6);
}

/**
 * Virtualized raw G-code view. G-code parameters are modal (a value stays in
 * effect until a later line changes it), so entire runs of lines are green
 * while the active parameter equals the target — like added lines in a diff.
 * Lines that explicitly set the parameter are emphasized: green when they set
 * the target value, red when they move it elsewhere.
 */
export function GcodeViewer({ text }: { text: string }) {
  const { t } = useI18n();
  const [param, setParam] = useState<TraceParam>('temp');
  const [targets, setTargets] = useState<Record<TraceParam, number>>({
    temp: DEFAULT_PARAMS.nozzleTemp,
    flow: DEFAULT_PARAMS.flowRate,
    speed: DEFAULT_PARAMS.travelSpeed,
    z: DEFAULT_PARAMS.zOffset,
  });
  const [cursor, setCursor] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { lines, trace } = useMemo(() => {
    const split = text.split(/\r?\n/);
    if (split.length > 0 && split[split.length - 1] === '') split.pop();
    return { lines: split, trace: traceGcode(split) };
  }, [text]);

  const events = trace[param];
  const target = targets[param];
  const total = lines.length;

  // Share of lines running at the target value (carry-forward over event runs).
  const coverage = useMemo(() => {
    if (total === 0) return 0;
    let at = 0;
    for (let i = 0; i < events.length; i++) {
      if (!atTarget(param, events[i].value, target)) continue;
      const end = i + 1 < events.length ? events[i + 1].line : total;
      at += end - events[i].line;
    }
    return Math.round((at / total) * 100);
  }, [events, param, target, total]);

  const boxH = Math.min(VIEW_H, total * ROW_H + 2);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + boxH) / ROW_H) + OVERSCAN);
  const lnWidth = `${Math.max(4, String(total).length) + 1}ch`;

  const scrollToLine = (line: number) => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, line * ROW_H - el.clientHeight / 2);
  };

  const jump = (dir: 1 | -1) => {
    if (events.length === 0) return;
    let next: number;
    if (cursor === -1) {
      // First jump: nearest set line below (or above) the current viewport top.
      const topLine = Math.floor((boxRef.current?.scrollTop ?? 0) / ROW_H);
      if (dir === 1) {
        next = events.findIndex((e) => e.line > topLine);
        if (next === -1) next = 0;
      } else {
        next = events.length - 1;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].line < topLine) {
            next = i;
            break;
          }
        }
      }
    } else {
      next = (cursor + dir + events.length) % events.length;
    }
    setCursor(next);
    scrollToLine(events[next].line);
  };

  const rows = [];
  for (let i = first; i < last; i++) {
    const ev = valueAt(events, i);
    const ok = ev !== null && atTarget(param, ev.value, target);
    const isSet = ev !== null && ev.line === i;
    const isCursor = cursor >= 0 && events[cursor]?.line === i;
    const cls =
      'gcv-row' + (ok ? ' ok' : '') + (isSet ? (ok ? ' set' : ' set off') : '') + (isCursor ? ' cursor' : '');
    rows.push(
      <div key={i} className={cls} style={{ top: i * ROW_H }}>
        <span className="ln" style={{ width: lnWidth }}>
          {i + 1}
        </span>
        <span className="pv">{ev ? fmtValue(param, ev.value) : ''}</span>
        <LineText line={lines[i]} param={param} set={isSet} />
      </div>,
    );
  }

  return (
    <div>
      <div className="gcv-head">
        <div className="chips" style={{ marginTop: 0 }}>
          {TRACE_PARAMS.map((p) => (
            <button
              key={p}
              className={`chip ${param === p ? 'active' : ''}`}
              onClick={() => {
                setParam(p);
                setCursor(-1);
              }}
            >
              {t(PARAM_LABEL[p])} · {trace[p].length}
            </button>
          ))}
        </div>
        <label className="gcv-target">
          {t('viewer.target')}
          <input
            type="number"
            step={PARAM_STEP[param]}
            value={target}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) setTargets((cur) => ({ ...cur, [param]: v }));
            }}
          />
          <span className="unit">{PARAM_UNIT[param]}</span>
        </label>
        <span className="gcv-cov" title={t('viewer.atTarget')}>
          <i className="sw" /> {coverage}%
        </span>
        <span className="spacer" />
        <span className="gcv-count">{cursor >= 0 ? `${cursor + 1} / ${events.length}` : events.length}</span>
        <button className="iconbtn" onClick={() => jump(-1)} disabled={events.length === 0} title={t('viewer.prev')}>
          ▲
        </button>
        <button className="iconbtn" onClick={() => jump(1)} disabled={events.length === 0} title={t('viewer.next')}>
          ▼
        </button>
      </div>
      <div className="gcv" ref={boxRef} style={{ height: boxH }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: total * ROW_H, position: 'relative' }}>{rows}</div>
      </div>
    </div>
  );
}

function LineText({ line, param, set }: { line: string; param: TraceParam; set: boolean }) {
  if (!set) return <span className="tx">{line}</span>;
  const m = matchParamOnLine(line, param);
  if (!m) return <span className="tx">{line}</span>;
  return (
    <span className="tx">
      {line.slice(0, m.start)}
      <mark>{line.slice(m.start, m.end)}</mark>
      {line.slice(m.end)}
    </span>
  );
}
