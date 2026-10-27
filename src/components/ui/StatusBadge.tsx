import type { HTMLAttributes } from 'react';
export function StatusBadge({ status, className = '', ...props }: HTMLAttributes<HTMLElement> & { status: string ;}) {
  return <small {...props} data-status={status} className={`status-badge ${className}`} />;
}
