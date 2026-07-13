import { useI18n } from '../i18n';
import { fmtFlowRatio } from '../engine/rewrite';
import type { SealParams } from '../engine/types';
import type { PlateProcessResult } from '../worker/protocol';

interface Props {
  plates: PlateProcessResult[];
  params: SealParams;
  multiPlate: boolean;
  exportEnabled: boolean;
  exporting: boolean;
  exportedName: string | null;
  onExport: () => void;
  onDownloadText: (which: 'before' | 'after') => void;
}

export function ExportPanel(props: Props) {
  const { t } = useI18n();
  const { plates, params, multiPlate, exportEnabled, exporting, exportedName, onExport, onDownloadText } = props;

  return (
    <div className="panel">
      <h2>{t('export.title')}</h2>

      <div className="report">
        <table>
          <tbody>
            {plates.map((p) => (
              <PlateReport key={p.index} plate={p} params={params} showHeader={multiPlate} />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ height: 10 }} />
      <button className="btn" disabled={!exportEnabled || exporting} onClick={onExport}>
        {t('export.button')}
      </button>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn secondary" onClick={() => onDownloadText('before')}>
          {t('export.before')}
        </button>
        <button className="btn secondary" onClick={() => onDownloadText('after')}>
          {t('export.after')}
        </button>
      </div>

      {exportedName && (
        <>
          <div className="export-done">✅ {t('export.done', { name: exportedName })}</div>
          <h2 style={{ marginTop: 14 }}>{t('export.safety.title')}</h2>
          <ul className="safety-list">
            <li>{t('export.safety.mat')}</li>
            <li>{t('export.safety.vent')}</li>
            <li>{t('export.safety.watch')}</li>
            <li>{t('export.safety.dry')}</li>
          </ul>
        </>
      )}
    </div>
  );
}

function PlateReport({ plate, params, showHeader }: { plate: PlateProcessResult; params: SealParams; showHeader: boolean }) {
  const { t } = useI18n();
  const r = plate.report;
  // Real parsed values, never canned display strings (FR-7).
  const tempOld = r.tempOld ?? '?';
  const flowOld = r.flowConfigOld ?? '?';
  return (
    <>
      {showHeader && (
        <tr>
          <td className="plate-h" colSpan={2}>
            {t('export.plate', { n: plate.index })}
          </td>
        </tr>
      )}
      <tr>
        <td>{t('export.temp')}</td>
        <td>{t('export.tempVal', { old: tempOld, new: params.nozzleTemp, exec: r.tempExecChanges, config: r.tempConfigChanges })}</td>
      </tr>
      <tr>
        <td>{t('export.z')}</td>
        <td>
          {r.zChanges > 0 || r.zOld !== null
            ? t('export.zVal', { old: r.zOld ?? '?', new: params.zOffset, n: r.zChanges })
            : t('export.zNone')}
        </td>
      </tr>
      <tr>
        <td>{t('export.flow')}</td>
        <td>
          {t('export.flowVal', {
            old: flowOld,
            new: fmtFlowRatio(params.flowRate),
            flow: Math.round(params.flowRate),
            config: r.flowConfigChanges,
          })}
        </td>
      </tr>
      <tr>
        <td>{t('export.speed')}</td>
        <td>{t('export.speedVal', { new: params.travelSpeed, n: r.travelChanges })}</td>
      </tr>
    </>
  );
}
