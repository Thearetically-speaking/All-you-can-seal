import { useCallback, useState } from 'react';
import { Dropzone } from './Dropzone';
import { GcodeViewer } from './GcodeViewer';
import { Tip } from './Tip';
import { useI18n } from '../i18n';
import { openThreeMf } from '../engine/threemf';
import { inspectGcode, FoundValue, GcodeInspection } from '../engine/inspect';

interface PlateInspection {
  index: number;
  text: string;
  inspection: GcodeInspection;
}

/**
 * Read-only validator (human in the loop): loads a .gcode.3mf / .gcode and
 * displays the four seal parameters found in the G-code, with evidence lines.
 * Runs on the main thread and never touches the converter worker's state.
 */
export function ValidatorTab() {
  const { t } = useI18n();
  const [fileName, setFileName] = useState<string | null>(null);
  const [plates, setPlates] = useState<PlateInspection[]>([]);
  const [viewPlate, setViewPlate] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const lower = file.name.toLowerCase();
        let texts: { index: number; text: string }[];
        if (lower.endsWith('.gcode') && !lower.endsWith('.gcode.3mf')) {
          texts = [{ index: 1, text: new TextDecoder().decode(bytes) }];
        } else {
          texts = openThreeMf(bytes).plates.map((p) => ({ index: p.index, text: p.text }));
        }
        setPlates(texts.map((p) => ({ index: p.index, text: p.text, inspection: inspectGcode(p.text) })));
        setViewPlate(texts[0]?.index ?? 1);
        setFileName(file.name);
      } catch (e) {
        const err = e as Error;
        if (err.message === 'not-a-zip') setError(t('err.not-a-zip'));
        else if (err.message === 'no-plate-gcode') setError(t('err.no-plate-gcode'));
        else setError(`${t('err.generic')} ${err.message}`);
        setPlates([]);
        setFileName(null);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  return (
    <div className="validator-wrap">
      <div className="panel">
        <h2>{t('validate.title')}</h2>
        <p className="hint">{t('validate.hint')}</p>
        <Dropzone onFile={onFile} onBadFile={setError} compact={fileName !== null} />
        {loading && <div className="spinner">{t('misc.loading')}</div>}
        {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {fileName !== null && (
        <div className="panel">
          <div className="kv"><span className="k">📄</span><span className="v">{fileName}</span></div>
          <div className="kv">
            <span className="k">{t('file.machine')}</span>
            <span className="v">{plates[0]?.inspection.info.machineName ?? t('file.unknown')}</span>
          </div>
          <div className="kv"><span className="k">{t('file.plates')}</span><span className="v">{plates.length}</span></div>
        </div>
      )}

      {plates.map((p) => (
        <PlatePanel key={p.index} plate={p} multiPlate={plates.length > 1} />
      ))}

      {plates.length > 0 && (
        <div className="panel">
          <h2>
            {t('viewer.title')}
            <Tip text={t('viewer.tip')} />
          </h2>
          {plates.length > 1 && (
            <div className="chips" style={{ marginBottom: 8 }}>
              {plates.map((p) => (
                <button
                  key={p.index}
                  className={`chip ${viewPlate === p.index ? 'active' : ''}`}
                  onClick={() => setViewPlate(p.index)}
                >
                  {t('plates.plate')} {p.index}
                </button>
              ))}
            </div>
          )}
          <GcodeViewer
            key={viewPlate}
            text={(plates.find((p) => p.index === viewPlate) ?? plates[0]).text}
          />
        </div>
      )}
    </div>
  );
}

const MAX_SHOWN = 5;

function fmtValues(values: FoundValue[], unit: string, notFound: string, more: (n: number) => string): string {
  if (values.length === 0) return notFound;
  const shown = values.slice(0, MAX_SHOWN).map((v) => `${v.value}${unit}${v.count > 1 ? ` ×${v.count}` : ''}`);
  const rest = values.length - MAX_SHOWN;
  return shown.join(', ') + (rest > 0 ? `, ${more(rest)}` : '');
}

function fmtExamples(values: FoundValue[]): string {
  return values.slice(0, 3).map((v) => v.example).join('  ·  ');
}

function PlatePanel({ plate, multiPlate }: { plate: PlateInspection; multiPlate: boolean }) {
  const { t } = useI18n();
  const { info, nozzleTemps, flowPercent, configFlowRatio, travelSpeeds, zOffset } = plate.inspection;
  const notFound = t('validate.notFound');
  const marker = info.processedMarker;

  const more = (n: number) => t('validate.more', { n });

  const rows: { label: string; value: string; evidence: string; missing: boolean }[] = [
    {
      label: t('validate.nozzleTemp'),
      value: fmtValues(nozzleTemps, '°C', notFound, more),
      evidence: fmtExamples(nozzleTemps),
      missing: nozzleTemps.length === 0,
    },
    {
      label: t('validate.flow'),
      value: flowPercent
        ? `${flowPercent.value}%${configFlowRatio !== null ? ` (filament_flow_ratio = ${configFlowRatio})` : ''}`
        : configFlowRatio !== null
          ? `${t('validate.noM221')} (filament_flow_ratio = ${configFlowRatio})`
          : notFound,
      evidence: flowPercent?.example ?? '',
      missing: flowPercent === null,
    },
    {
      label: t('validate.speed'),
      value: fmtValues(travelSpeeds, ' mm/s', notFound, more),
      evidence: fmtExamples(travelSpeeds),
      missing: travelSpeeds.length === 0,
    },
    {
      label: t('validate.zOffset'),
      value: zOffset ? `${zOffset.value} mm` : notFound,
      evidence: zOffset?.example ?? '',
      missing: zOffset === null,
    },
  ];

  return (
    <div className="panel">
      {multiPlate && <h2>{t('plates.plate')} {plate.index}</h2>}
      {marker ? (
        <div className="marker-box ok">
          ✔ {t('validate.marker.found', { version: marker.version })}
          {marker.params && (
            <div className="mono dim-line">
              {t('params.nozzleTemp')}: {marker.params.nozzleTemp ?? '?'}°C · {t('validate.flowShort')}:{' '}
              {marker.params.flowRate ?? '?'}% · {t('params.travelSpeed')}: {marker.params.travelSpeed ?? '?'} mm/s ·{' '}
              {t('params.zOffset')}: {marker.params.zOffset ?? '?'} mm
            </div>
          )}
        </div>
      ) : (
        <div className="marker-box none">ℹ {t('validate.marker.none')}</div>
      )}
      <table className="vtable">
        <thead>
          <tr>
            <th>{t('validate.param')}</th>
            <th>{t('validate.detected')}</th>
            <th>{t('validate.evidence')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className={r.missing ? 'missing' : 'val'}>{r.value}</td>
              <td className="mono">{r.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
