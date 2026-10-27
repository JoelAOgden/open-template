import { Button } from "./Button";
import { Children, isValidElement, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

type OptionProps = { value: string; disabled?: boolean; children: ReactNode ;};
export function Option(_: OptionProps) { return null; }
export function Select({ value, onChange, children, disabled = false, variant = "field", ...attributes }: {
  value: string | undefined; onChange: (event: { target: { value: string ;} ;}) => void; children: ReactNode; disabled?: boolean;
  id?: string; 'aria-label'?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; className?: string; variant?: 'field' | 'compact' | 'quiet';
}) {
  const options = Children.toArray(children).filter(isValidElement<OptionProps>).map(child => child.props);
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const id = useId(); const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const search = useRef({ text: '', time: 0 });
  const enabled = options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
  function show() { if (disabled || !enabled.length) return; const chosen = options.findIndex(o => o.value === value && !o.disabled); setActive(chosen >= 0 ? chosen : enabled[0]); search.current = { text: "", time: 0 }; setOpen(true); }
  function choose(index: number) { const option = options[index]; if (!option || option.disabled) return; onChange({ target: { value: option.value } }); setOpen(false); trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open) return;
    function positionList() { const r = trigger.current!.getBoundingClientRect(); const below = innerHeight - r.bottom - 12, above = r.top - 12; const expected = Math.min(280, options.length * 36 + 8); const height = Math.min(expected, Math.max(below, above)); setPosition({ left: Math.max(8, Math.min(r.left, innerWidth - r.width - 8)), top: below >= Math.min(280, options.length * 36 + 8) ? r.bottom + 4 : Math.max(8, r.top - height - 4), width: Math.min(r.width, innerWidth - 16), maxHeight: height }); }
    positionList();
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('resize', positionList); document.addEventListener('scroll', positionList, true); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', positionList); document.removeEventListener('scroll', positionList, true); document.removeEventListener('pointerdown', outside); };
  }, [open, options.length]);
  useEffect(() => { if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  return <><Button {...attributes} ref={trigger} data-variant={variant} type="button" role="combobox" value={value} disabled={disabled || !enabled.length}
    className={`custom-select ${attributes.className ?? ''}`} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined}
    aria-activedescendant={open ? `${id}-${active}` : undefined}
    onClick={() => open ? setOpen(false) : show()} onBlur={e => { if (!list.current?.contains(e.relatedTarget)) setOpen(false); }}
    onKeyDown={e => {
      if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); if (!enabled.length) return; if (!open) { show(); return; }
        const index = enabled.indexOf(active); setActive(e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled.at(-1)! : enabled[(index + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]); return;
      }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? choose(active) : show(); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); if (!open) show(); const now = Date.now(); search.current = { text: (now - search.current.time > 700 ? '' : search.current.text) + e.key.toLowerCase(), time: now };
        const found = options.findIndex(o => !o.disabled && Children.toArray(o.children).join('').toLowerCase().startsWith(search.current.text));
        if (found >= 0) setActive(found);
      }
    }}><span>{options.find(o => o.value === value)?.children ?? 'Choose…'}</span><ChevronDown size={14} /></Button>
    {open && createPortal(<div ref={list} id={id} role="listbox" aria-label={attributes['aria-label'] ?? 'Options'} className="custom-select-menu" style={position}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value} aria-disabled={option.disabled || undefined}
        data-value={option.value} data-index={index} data-active={index === active} className="custom-select-option" onPointerDown={e => e.preventDefault()}
        onPointerMove={() => !option.disabled && setActive(index)} onClick={() => choose(index)}><span>{option.children}</span>{value === option.value && <Check size={14} />}</div>)}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </>;
}
