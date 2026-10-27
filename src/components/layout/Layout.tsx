import type { HTMLAttributes } from 'react';
type Props = HTMLAttributes<HTMLDivElement>;
export function Stack({ className = '', ...props }: Props) { return <div className={`layout-stack ${className}`} {...props} />; }
export function Row({ className = '', ...props }: Props) { return <div className={`layout-row ${className}`} {...props} />; }
export function Panel({ className = '', ...props }: HTMLAttributes<HTMLElement>) { return <section className={`layout-panel ${className}`} {...props} />; }
