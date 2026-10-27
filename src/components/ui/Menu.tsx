import { forwardRef, type HTMLAttributes } from 'react';
/** Action menus share keyboard behaviour; selection dropdowns use Select instead. */
export const Menu = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Menu({ onKeyDown, ...props }, ref) {
  return <div {...props} ref={ref} role="menu" onKeyDown={event => {
    onKeyDown?.(event); if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')); if (!items.length) return;
    event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next].focus();
  }} />;
});
