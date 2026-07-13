import { useI18n, StringKey } from '../i18n';
import type { CheckItem } from '../engine/types';
import type { PlateProcessResult } from '../worker/protocol';

interface Props {
  plates: PlateProcessResult[];
  force: boolean;
  onForceChange: (v: boolean) => void;
  canExport: boolean;
  canForceExport: boolean;
}

const ICON: Record<CheckItem['status'], string> = { pass: '✅', warn: '⚠️', fail: '❌' };
const RANK: Record<CheckItem['status'], number> = { pass: 0, warn: 1, fail: 2 };

/** Merge per-plate check items: for each check id keep the worst status across selected plates. */
export function mergeChecks(plates: PlateProcessResult[]): CheckItem[] {
  const merged = new Map<string, CheckItem>();
  for (const plate of plates) {
    for (const item of plate.checks.items) {
      const prev = merged.get(item.id);
      if (!prev || RANK[item.status] > RANK[prev.status]) merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

export function ChecksPanel({ plates, force, onForceChange, canExport, canForceExport }: Props) {
  const { t } = useI18n();
  const items = mergeChecks(plates);

  return (
    <div className="panel">
      <h2>{t('checks.title')}</h2>
      {items.map((item) => (
        <details key={item.id} className={`check ${item.status}`} open={item.status === 'fail'}>
          <summary>
            <span className="dot">{ICON[item.status]}</span>
            {t(`checks.${item.id}.title` as StringKey)}
          </summary>
          <div className="desc">{t(`checks.${item.id}.desc` as StringKey, item.data)}</div>
        </details>
      ))}
      {!canExport && canForceExport && (
        <>
          <div className="desc" style={{ color: 'var(--fail)', fontSize: 12, margin: '10px 0 0' }}>
            {t('checks.hardFail')}
          </div>
          <label className="force-row">
            <input type="checkbox" checked={force} onChange={(e) => onForceChange(e.target.checked)} />
            {t('checks.force')}
          </label>
        </>
      )}
    </div>
  );
}
