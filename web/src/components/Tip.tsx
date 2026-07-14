import type { ReactNode } from 'react';

interface Props {
  text: string;
  /** Element that triggers the tooltip; defaults to a small "?" badge. */
  children?: ReactNode;
}

/** Hover / focus tooltip. Keeps explanatory text out of the main layout. */
export function Tip({ text, children }: Props) {
  return (
    <span className="tip" tabIndex={0}>
      {children ?? <span className="qmark">?</span>}
      <span className="tipbox" role="tooltip">
        {text}
      </span>
    </span>
  );
}
