import { useI18n, StringKey } from '../i18n';
import { DEFAULT_PARAMS, PARAM_LIMITS, SealParams, Z_WARN_BELOW } from '../engine/types';

interface Props {
  params: SealParams;
  onChange: (p: SealParams) => void;
  remember: boolean;
  onRememberChange: (v: boolean) => void;
  /** Machine hotend limit further clamps the temperature range (FR-3). */
  machineMaxTemp: number;
}

interface RowProps {
  id: keyof SealParams;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  warn?: string | null;
  onChange: (v: number) => void;
}

function ParamRow({ id, unit, min, max, step, value, warn, onChange }: RowProps) {
  const { t } = useI18n();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={`param ${warn ? 'warned' : ''}`}>
      <div className="row1">
        <label htmlFor={`p-${id}`}>{t(`params.${id}` as StringKey)}</label>
        <span className="hint" style={{ margin: 0 }}>
          {min} – {max} {unit}
        </span>
      </div>
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
          id={`p-${id}`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(clamp(v));
          }}
        />
        <span className="unit">{unit}</span>
      </div>
      <p className="hint">{t(`params.${id}.hint` as StringKey)}</p>
      {warn && <div className="warn-msg">⚠ {warn}</div>}
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
        warn={params.zOffset < Z_WARN_BELOW ? t('params.zOffset.warn') : null}
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
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className="btn secondary" onClick={() => onChange({ ...DEFAULT_PARAMS })}>
          {t('params.reset')}
        </button>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={remember} onChange={(e) => onRememberChange(e.target.checked)} />
        {t('params.remember')}
      </label>
    </div>
  );
}
