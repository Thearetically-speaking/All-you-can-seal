import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dropzone } from './components/Dropzone';
import { ValidatorTab } from './components/ValidatorTab';
import { ParamPanel } from './components/ParamPanel';
import { ChecksPanel } from './components/ChecksPanel';
import { ExportPanel } from './components/ExportPanel';
import { Preview3D } from './components/Preview3D';
import { useI18n } from './i18n';
import { findMachine } from './engine/machines';
import { DEFAULT_PARAMS, PARAM_LIMITS, SealParams } from './engine/types';
import { SealWorkerClient } from './worker/client';
import type { LoadResult, PlateMeta, ProcessResult } from './worker/protocol';

const PARAMS_KEY = 'aycs-params';
const REMEMBER_KEY = 'aycs-remember';
const THEME_KEY = 'aycs-theme';

function loadStoredParams(): SealParams {
  if (localStorage.getItem(REMEMBER_KEY) === '1') {
    try {
      const p = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '');
      if (p && typeof p.nozzleTemp === 'number') return { ...DEFAULT_PARAMS, ...p };
    } catch {
      /* fall through */
    }
  }
  return { ...DEFAULT_PARAMS };
}

function downloadBlob(name: string, data: Uint8Array | string, type: string) {
  const part: BlobPart = typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const client = useMemo(() => new SealWorkerClient(), []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [tab, setTab] = useState<'convert' | 'validate'>('convert');
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [previewPlate, setPreviewPlate] = useState(1);
  const [params, setParams] = useState<SealParams>(loadStoredParams);
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) === '1');
  const [sourceTempOverride, setSourceTempOverride] = useState<number | null>(null);
  const [proc, setProc] = useState<ProcessResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [force, setForce] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedName, setExportedName] = useState<string | null>(null);

  // Param persistence (FR-3, optional & clearable).
  useEffect(() => {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, '1');
      localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
    } else {
      localStorage.removeItem(REMEMBER_KEY);
      localStorage.removeItem(PARAMS_KEY);
    }
  }, [remember, params]);

  const mapError = useCallback(
    (e: Error): string => {
      if (e.message === 'not-a-zip') return t('err.not-a-zip');
      if (e.message === 'no-plate-gcode') return t('err.no-plate-gcode');
      return `${t('err.generic')} ${e.message}`;
    },
    [t],
  );

  const onFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      setLoaded(null);
      setProc(null);
      setExportedName(null);
      setForce(false);
      setSourceTempOverride(null);
      try {
        const buf = await file.arrayBuffer();
        const result = await client.load(file.name, buf);
        setLoaded(result);
        // Multi-plate default: convert the first plate only (PRD open question #1).
        const first = result.plates[0].index;
        setSelected([first]);
        setPreviewPlate(first);
      } catch (e) {
        setError(mapError(e as Error));
      } finally {
        setLoading(false);
      }
    },
    [client, mapError],
  );

  // Re-process on any input change (engine is fast; no manual "apply" button).
  useEffect(() => {
    if (!loaded || selected.length === 0) {
      setProc(null);
      return;
    }
    setProcessing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await client.process(selected, previewPlate, params, sourceTempOverride);
        setProc(result);
        setExportedName(null);
      } catch (e) {
        setError(mapError(e as Error));
      } finally {
        setProcessing(false);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [client, loaded, selected, previewPlate, params, sourceTempOverride, mapError]);

  const previewMeta: PlateMeta | null = loaded?.plates.find((p) => p.index === previewPlate) ?? loaded?.plates[0] ?? null;
  const machine = findMachine(previewMeta?.info.machineName ?? previewMeta?.info.printerModel);
  const machineLabel = machine.key !== 'unknown' ? machine.names[0] : previewMeta?.info.machineName ?? t('file.unknown');
  const sourceTempMissing =
    previewMeta != null && previewMeta.info.sourceTempInitial === null && previewMeta.info.sourceTempNozzle === null;

  const canExport = (proc?.plates.length ?? 0) > 0 && proc!.plates.every((p) => p.checks.canExport);
  const canForceExport = (proc?.plates.length ?? 0) > 0 && proc!.plates.every((p) => p.checks.canForceExport);
  const exportEnabled = !processing && (canExport || (force && canForceExport));

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await client.export(selected, params, sourceTempOverride);
      downloadBlob(result.fileName, result.bytes, 'application/octet-stream');
      setExportedName(result.fileName);
    } catch (e) {
      setError(mapError(e as Error));
    } finally {
      setExporting(false);
    }
  }, [client, selected, params, sourceTempOverride, mapError]);

  const onDownloadText = useCallback(
    async (which: 'before' | 'after') => {
      if (!loaded) return;
      const { text } = await client.plainText(previewPlate, which, params, sourceTempOverride);
      const base = loaded.fileName.replace(/\.gcode(\.3mf)?$/i, '');
      downloadBlob(`${base}.${which}.gcode`, text, 'text/plain');
    },
    [client, loaded, previewPlate, params, sourceTempOverride],
  );

  const srcTempLabel = useMemo(() => {
    if (!previewMeta) return '';
    const { sourceTempInitial: a, sourceTempNozzle: b } = previewMeta.info;
    if (a === null && b === null) return sourceTempOverride != null ? String(sourceTempOverride) : '?';
    if (a !== null && b !== null && a !== b) return `${a}/${b}`;
    return String(a ?? b);
  }, [previewMeta, sourceTempOverride]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('app.title')}</h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'convert' ? 'active' : ''}`} onClick={() => setTab('convert')}>
            {t('tabs.convert')}
          </button>
          <button className={`tab ${tab === 'validate' ? 'active' : ''}`} onClick={() => setTab('validate')}>
            {t('tabs.validate')}
          </button>
        </nav>
        <span className="subtitle">{t('app.subtitle')}</span>
        <span className="privacy">🔒 {t('app.privacy')}</span>
        <button className="iconbtn" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
          {t('misc.lang')}
        </button>
        <button className="iconbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {tab === 'convert' &&
      (!loaded ? (
        <div className="dropzone-wrap">
          <Dropzone onFile={onFile} onBadFile={setError} />
          {loading && <div className="spinner">{t('misc.loading')}</div>}
          {error && <div className="error-box">{error}</div>}
        </div>
      ) : (
        <div className="columns">
          {/* left: file + plates + params */}
          <div className="col">
            <div className="panel">
              <h2>{t('file.info')}</h2>
              <div className="kv"><span className="k">📄</span><span className="v">{loaded.fileName}</span></div>
              <div className="kv">
                <span className="k">{t('file.machine')}</span>
                <span className="v">{machineLabel} · {machine.bed[0]}×{machine.bed[1]} mm</span>
              </div>
              <div className="kv"><span className="k">{t('file.plates')}</span><span className="v">{loaded.plates.length}</span></div>
              <div className="kv">
                <span className="k">{t('file.layers')}</span>
                <span className="v">{previewMeta?.info.totalLayers ?? t('file.unknown')}</span>
              </div>
              <div className="kv">
                <span className="k">{t('file.slicedTemp')}</span>
                <span className="v">{t('file.slicedTempArrow', { src: srcTempLabel, dst: params.nozzleTemp })}</span>
              </div>
              {proc?.toolpath && (
                <div className="kv">
                  <span className="k">{t('file.pathLength')}</span>
                  <span className="v">{(proc.toolpath.sealLength / 10).toFixed(1)} cm</span>
                </div>
              )}
              {sourceTempMissing && (
                <div style={{ marginTop: 8 }}>
                  <div className="warn-msg" style={{ color: 'var(--warn)', fontSize: 12 }}>⚠ {t('file.sourceTempMissing')}</div>
                  <input
                    type="number"
                    min={PARAM_LIMITS.nozzleTemp.min}
                    max={PARAM_LIMITS.nozzleTemp.max}
                    value={sourceTempOverride ?? ''}
                    placeholder="230"
                    style={{ marginTop: 6, width: 90, padding: '4px 6px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setSourceTempOverride(Number.isNaN(v) ? null : v);
                    }}
                  />
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Dropzone onFile={onFile} onBadFile={setError} compact />
              </div>
              {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
            </div>

            {loaded.plates.length > 1 && (
              <div className="panel">
                <h2>{t('plates.title')}</h2>
                <p className="hint">{t('plates.hint')}</p>
                <div className="plate-list">
                  {loaded.plates.map((p) => (
                    <PlateItem
                      key={p.index}
                      plate={p}
                      selected={selected.includes(p.index)}
                      onToggle={() => {
                        setSelected((cur) =>
                          cur.includes(p.index) ? cur.filter((i) => i !== p.index) : [...cur, p.index].sort((a, b) => a - b),
                        );
                        setPreviewPlate(p.index);
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn secondary" onClick={() => setSelected(loaded.plates.map((p) => p.index))}>
                    {t('plates.all')}
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>{t('misc.previewPlate', { n: proc?.previewPlate ?? previewPlate })}</p>
              </div>
            )}

            <ParamPanel
              params={params}
              onChange={setParams}
              remember={remember}
              onRememberChange={setRemember}
              machineMaxTemp={machine.maxHotendTemp}
            />
          </div>

          {/* center: 3D preview */}
          <div className="col center">
            <Preview3D toolpath={proc?.toolpath ?? null} bed={machine.bed} dark={theme === 'dark'} />
          </div>

          {/* right: checks + export */}
          <div className="col">
            {processing && <div className="spinner">{t('misc.processing')}</div>}
            {proc && (
              <>
                <ChecksPanel
                  plates={proc.plates}
                  force={force}
                  onForceChange={setForce}
                  canExport={canExport}
                  canForceExport={canForceExport}
                />
                <ExportPanel
                  plates={proc.plates}
                  params={params}
                  multiPlate={loaded.plates.length > 1}
                  exportEnabled={exportEnabled}
                  exporting={exporting}
                  exportedName={exportedName}
                  onExport={onExport}
                  onDownloadText={onDownloadText}
                />
              </>
            )}
          </div>
        </div>
      ))}
      {/* Kept mounted so the validator's loaded file survives tab switches. */}
      <div className="tab-body" hidden={tab !== 'validate'}>
        <ValidatorTab />
      </div>
      <div className="footer">{t('misc.footer')}</div>
    </div>
  );
}

function PlateItem({ plate, selected, onToggle }: { plate: PlateMeta; selected: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!plate.thumbnail) return;
    const url = URL.createObjectURL(new Blob([plate.thumbnail.slice()], { type: 'image/png' }));
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [plate.thumbnail]);

  return (
    <div className={`plate-item ${selected ? 'sel' : ''}`} onClick={onToggle}>
      <input type="checkbox" checked={selected} readOnly />
      {thumbUrl && <img src={thumbUrl} alt={`plate ${plate.index}`} />}
      <div className="meta">
        <b>
          {t('plates.plate')} {plate.index}
        </b>
        {plate.info.totalLayers ?? '?'} {t('file.layers').toLowerCase()} · {(plate.gcodeBytes / 1024).toFixed(0)} KB
      </div>
    </div>
  );
}
