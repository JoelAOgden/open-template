import { useEffect, useRef } from 'react';
export function SplitHandle({ value, onChange, min = 180, max = 360, label = 'Resize panel', className = '' }: { value: number; onChange: (value: number) => void; min?: number; max?: number; label?: string; className?: string ;}) {
  const cleanup = useRef<() => void>(() => { }); useEffect(() => () => cleanup.current(), []);
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} className={className}
    onPointerDown={event => {      
event.preventDefault(); cleanup.current(); const start = event.clientX;
      const move = (e: PointerEvent) => change(value + e.clientX - start); const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
      cleanup.current = end; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); change(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === 'ArrowRight' ? 20 : -20)); } }} />;
}
