import type { HTMLAttributes } from 'react';
/** Views remain mounted so editors, selections and scroll positions survive navigation. */
export function WorkspaceView({ id, labelledBy, active, children, ...props }: HTMLAttributes<HTMLElement> & { id: string; labelledBy: string; active: boolean ;}) {
  return <section {...props} id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active}>{children}</section>;
}
