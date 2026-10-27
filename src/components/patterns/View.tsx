import type { HTMLAttributes } from 'react';
export function ViewHeader({ className = '', alignment = 'between', ...props }: HTMLAttributes<HTMLDivElement> & { alignment?: 'start' | 'between' ;}) { return <div data-alignment={alignment} className={`view-header ${className}`} {...props} />; }
export function Toolbar({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={`view-toolbar ${className}`} {...props} />; }
export function Actions({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={`actions ${className}`} {...props} />; }
