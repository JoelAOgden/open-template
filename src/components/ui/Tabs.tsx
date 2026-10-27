import type { HTMLAttributes } from 'react';
import { Button, type ButtonProps } from './Button';
export function Tabs({ onKeyDown, ...props }: HTMLAttributes<HTMLDivElement>) {  
return <div {...props} role="tablist" onKeyDown={event => {
    onKeyDown?.(event); if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')); if (!tabs.length) return;
    event.preventDefault(); const index = tabs.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); tabs[next].click();
  }} />;
}
export function Tab(props: ButtonProps) { return <Button {...props} role="tab" tabIndex={props['aria-selected'] ? 0 : -1} />; }
export function TabPanel(props: HTMLAttributes<HTMLElement>) { return <section {...props} role="tabpanel" />; }
