import { useEffect, useState } from 'react';
import { useI18n, StringKey } from '../i18n';
import type { CheckItem } from '../engine/types';
import type { PlateProcessResult } from '../worker/protocol';

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

interface Props {
  plates: PlateProcessResult[];
  /** Free-form error message (e.g. file parse failure), shown as a fail toast. */
  error: string | null;
  onErrorDismiss: () => void;
  /** Changes when a new file is loaded; re-shows previously dismissed notices. */
  resetKey: string;
}

/**
 * Side notifications for checks that did NOT pass (FR-6). Passing checks stay
 * silent; warnings and failures pop up here and can be dismissed individually.
 */
export function Notifications({ plates, error, onErrorDismiss, resetKey }: Props) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => setDismissed(new Set()), [resetKey]);

  const notices = mergeChecks(plates).filter((i) => i.status !== 'pass' && !dismissed.has(`${i.id}:${i.status}`));

  if (notices.length === 0 && !error) return null;

  return (
    <div className="toasts">
      {error && (
        <div className="toast fail">
          <div className="toast-body">{error}</div>
          <button className="toast-x" aria-label={t('misc.dismiss')} onClick={onErrorDismiss}>
            ×
          </button>
        </div>
      )}
      {notices.map((item) => (
        <div key={item.id} className={`toast ${item.status}`}>
          <div className="toast-body">
            <b>{t(`checks.${item.id}.title` as StringKey)}</b>
            <div className="toast-desc">{t(`checks.${item.id}.desc` as StringKey, item.data)}</div>
          </div>
          <button
            className="toast-x"
            aria-label={t('misc.dismiss')}
            onClick={() => setDismissed((cur) => new Set(cur).add(`${item.id}:${item.status}`))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
