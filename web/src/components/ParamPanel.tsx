import { useEffect, useState } from 'react';
import { useI18n, StringKey } from '../i18n';
import { DEFAULT_PARAMS, PARAM_LIMITS, SealParams } from '../engine/types';
import { Tip } from './Tip';

interface Props {
  params: SealParams;
  onChange: (p: SealParams) => void;
  remember: boolean;
  onRememberChange: (v: boolean) => void;
  /** Machine hotend limit further clamps the temperature range (FR-3). */
  machineMaxTemp: number;
}

/** Quick-pick values per parameter; the middle one is the default. */
const PRESETS: Record<keyof SealParams, number[]> = {
  nozzleTemp: [240, 260, 280],
  zOffset: [-0.1, -0.15, -0.2],
  flowRate: [100, 120, 150],
  travelSpeed: [3, 5, 10],
};

interface RowProps {
  id: keyof SealParams;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

function fmt(id: keyof SealParams, v: number): string {
  return id === 'zOffset' ? v.toFixed(2) : String(v);
}

function ParamRow({ id, unit, min, max, step, value, onChange }: RowProps) {
  const { t } = useI18n();
  const presets = PRESETS[id].filter((v) => v >= min && v <= max);
  const isPreset = presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  // Local text state so partial input ("-0.", "2") is not clamped mid-keystroke.
  const [text, setText] = useState(fmt(id, value));
  useEffect(() => setText(fmt(id, value)), [id, value]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) {
      setText(fmt(id, value)); // invalid → revert
      return;
    }
    const c = clamp(v);
    setText(fmt(id, c));
    onChange(c);
  };

  return (
    <div className="param">
      <div className="row1">
        <label>
          {t(`params.${id}` as StringKey)}
          <Tip text={t(`params.${id}.hint` as StringKey)} />
        </label>
        <span className="cur">
          {fmt(id, value)} {unit}
        </span>
      </div>
      <div className="chips">
        {presets.map((v) => (
          <button
            key={v}
            className={`chip ${!custom && value === v ? 'active' : ''}`}
            onClick={() => {
              setCustom(false);
              onChange(v);
            }}
          >
            {fmt(id, v)}
          </button>
        ))}
        <button className={`chip ${custom ? 'active' : ''}`} onClick={() => setCustom(true)}>
          {t('params.custom')}
        </button>
      </div>
      {custom && (
        <div className="row2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="unit">
            {min}–{max}
          </span>
        </div>
      )}
    </div>
  );
}

export function ParamPanel({ params, onChange, remember, onRememberChange, machineMaxTemp }: Props) {
  const { t } = useI18n();
  const set = (k: keyof SealParams) => (v: number) => onChange({ ...params, [k]: v });
  const tempMax = Math.min(PARAM_LIMITS.nozzleTemp.max, machineMaxTemp);

  return (
    <div className="panel">
      <h2>{t('params.title')}</h2>
      <ParamRow
        id="nozzleTemp"
        unit="°C"
        min={PARAM_LIMITS.nozzleTemp.min}
        max={tempMax}
        step={PARAM_LIMITS.nozzleTemp.step}
        value={params.nozzleTemp}
        onChange={set('nozzleTemp')}
      />
      <ParamRow
        id="zOffset"
        unit="mm"
        min={PARAM_LIMITS.zOffset.min}
        max={PARAM_LIMITS.zOffset.max}
        step={PARAM_LIMITS.zOffset.step}
        value={params.zOffset}
        onChange={set('zOffset')}
      />
      <ParamRow
        id="flowRate"
        unit="%"
        min={PARAM_LIMITS.flowRate.min}
        max={PARAM_LIMITS.flowRate.max}
        step={PARAM_LIMITS.flowRate.step}
        value={params.flowRate}
        onChange={set('flowRate')}
      />
      <ParamRow
        id="travelSpeed"
        unit="mm/s"
        min={PARAM_LIMITS.travelSpeed.min}
        max={PARAM_LIMITS.travelSpeed.max}
        step={PARAM_LIMITS.travelSpeed.step}
        value={params.travelSpeed}
        onChange={set('travelSpeed')}
      />
      <div className="param-foot">
        <label className="checkbox-row">
          <input type="checkbox" checked={remember} onChange={(e) => onRememberChange(e.target.checked)} />
          {t('params.remember')}
        </label>
        <button className="linkbtn" onClick={() => onChange({ ...DEFAULT_PARAMS })}>
          {t('params.reset')}
        </button>
      </div>
    </div>
  );
}
