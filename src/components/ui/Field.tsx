import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { Label } from './Fields';
import { Text } from './Typography';
type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean ;};
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: string; error?: string; children: ReactElement<ControlProps> ;}) {
  const generated = useId(), id = children.props.id ?? generated;
  const description = [children.props['aria-describedby'], hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return <div className="ui-field"><Label htmlFor={id}>{label}</Label>{cloneElement(children, { id, 'aria-describedby': description, 'aria-invalid': !!error || children.props['aria-invalid'] })}
    {hint && <Text id={`${id}-hint`} tone="muted">{hint}</Text>}{error && <Text id={`${id}-error`} tone="danger" role="alert">{error}</Text>}</div>;
}
