import { cloneElement, useId, useState, type ReactElement, type ReactNode, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement<HTMLAttributes<HTMLElement>> ;}) {
  const id = useId(), [anchor, setAnchor] = useState<DOMRect | null>(null);
  return <>{cloneElement(children, {
    'aria-describedby': [children.props['aria-describedby'], anchor ? id : null].filter(Boolean).join(' ') || undefined,
    onMouseEnter: event => { children.props.onMouseEnter?.(event); setAnchor(event.currentTarget.getBoundingClientRect()); },
    onMouseLeave: event => { children.props.onMouseLeave?.(event); setAnchor(null); },
    onFocus: event => { children.props.onFocus?.(event); setAnchor(event.currentTarget.getBoundingClientRect()); },
    onBlur: event => { children.props.onBlur?.(event); setAnchor(null); },
    onKeyDown: event => { children.props.onKeyDown?.(event); if (event.key === 'Escape') setAnchor(null); }
  })}{anchor && createPortal(<span role="tooltip" id={id} className="ui-tooltip" style={{ left: Math.max(8, Math.min(anchor.left, innerWidth - 248)), top: Math.max(8, Math.min(anchor.bottom + 6, innerHeight - 60)) }}>{label}</span>, document.activeElement?.closest('dialog') ?? document.body)}</>;
}
