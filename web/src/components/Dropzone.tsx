import { useRef, useState, DragEvent } from 'react';
import { useI18n } from '../i18n';

interface Props {
  onFile: (file: File) => void;
  onBadFile: (msg: string) => void;
  compact?: boolean;
}

export function Dropzone({ onFile, onBadFile, compact }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const accept = (file: File | undefined | null) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.gcode.3mf') && !lower.endsWith('.gcode')) {
      onBadFile(t('drop.badExt'));
      return;
    }
    onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    accept(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      style={compact ? { padding: '14px 16px' } : undefined}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
    >
      <div className="big">{t('drop.title')}</div>
      <div className="dim">{t('drop.or')}</div>
      {!compact && <div className="dim" style={{ marginTop: 10 }}>{t('drop.hint')}</div>}
      <input
        ref={inputRef}
        type="file"
        accept=".3mf,.gcode"
        style={{ display: 'none' }}
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
