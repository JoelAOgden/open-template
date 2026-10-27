import { forwardRef, useEffect, useRef, type DialogHTMLAttributes, type RefObject } from 'react';
export const Dialog = forwardRef<HTMLDialogElement, DialogHTMLAttributes<HTMLDialogElement>>(function Dialog({ onClose, ...props }, ref) { return <dialog {...props} ref={ref} onClose={event => { if (!event.currentTarget.open) onClose?.(event); }} />; });
export function useDialog(): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current!, previous = document.activeElement; node.showModal(); return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return ref;
}
